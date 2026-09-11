import { useMemo, useRef } from "react";
import {
  useLocalParticipant,
  useSpeakingParticipants,
  useTracks,
  VideoTrack,
} from "@livekit/components-react";
import { Track, VideoPreset } from "livekit-client";
import { MonitorUp, MonitorX } from "lucide-react";
import type { ParticipantSnapshot } from "@school/shared";

import { toast } from "@/shared/ui/sonner";
import { RoomControlButton } from "./RoomControlButton.js";

/**
 * Э7.1, §5.2 ТЗ: «1080p@5fps для документов». `ScreenSharePresets`
 * (установленный `livekit-client@2.22.0`) не содержит готового пресета на
 * 5 fps (есть только `h1080fps15`/`h1080fps30`) — собственный `VideoPreset`
 * по тому же образцу. Битрейт 1 Мбит/с — ОЦЕНКА, не факт из ТЗ/LiveKit:
 * `h1080fps15` берёт 2.5 Мбит/с на 15 fps, при втрое меньшем fps (5)
 * пропорционально вышло бы ~0.83 Мбит/с, округлено чуть вверх ради чёткости
 * текста документа (низкий fps не должен экономить на резкости кадра).
 *
 * Э12.7 UX: выбор «документ / видео» из панели убран (ученики и пожилые
 * учителя не должны выбирать fps/битрейт). Демонстрация всегда стартует в
 * профиле «документ» — приоритет чёткости текста, это типовой случай урока.
 */
const DOCUMENT_SCREEN_SHARE_PRESET = new VideoPreset(1920, 1080, 1_000_000, 5, "medium");

/**
 * Доп. — авто-«картинка в картинке» на время демонстрации (запрос
 * пользователя: «как в Толке», но включается ТОЛЬКО на время демо, не
 * отдельной кнопкой в интерфейсе). Пока делится экраном, собственное окно
 * урока часто занято чужим приложением/окном — плавающее видео держит
 * собеседника (обычно ученика) на виду.
 *
 * Кого показывать: закреплённый участник (Э6.3 — это и есть штатный
 * способ учителя сказать «сейчас важен этот ученик»), иначе говорящий,
 * иначе первый по тому же порядку, что плитки в `RoomVideoGrid`
 * (сначала персонал, потом по времени входа). Только с включённой
 * камерой — без видео показать нечего.
 */
function pickPipTarget<T>(
  participants: ParticipantSnapshot[],
  selfId: string | undefined,
  cameraTrackByIdentity: Map<string, T>,
  speakingIds: Set<string>,
): T | null {
  const candidates = participants.filter(
    (p) => p.connected && p.userId !== selfId && cameraTrackByIdentity.has(p.userId),
  );
  if (candidates.length === 0) return null;
  const pinned = candidates.find((p) => p.pinned);
  if (pinned) return cameraTrackByIdentity.get(pinned.userId)!;
  const speaking = candidates.find((p) => speakingIds.has(p.userId));
  if (speaking) return cameraTrackByIdentity.get(speaking.userId)!;
  const sorted = [...candidates].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "staff" ? -1 : 1;
    return a.joinedAt.localeCompare(b.joinedAt);
  });
  return cameraTrackByIdentity.get(sorted[0]!.userId)!;
}

/**
 * Демонстрация экрана (Э7.1) — переключатель типа контента ДО старта:
 * «Документ» (1080p@5fps, `contentHint: "detail"` — приоритет чёткости
 * текста над плавностью) или «Видео» (720p@15fps, `contentHint: "motion"`).
 * Аудио вкладки НЕ запрашивается (`audio: false`) — стоп-лист Э7: «не
 * делать шаринг вкладки со звуком в MVP». `screenShareEncoding`, не
 * `videoEncoding` — прочитано в типах `TrackPublishDefaults`
 * (`options.d.ts`): `videoEncoding` — это параметры именно КАМЕРЫ,
 * демонстрация экрана кодируется отдельным полем.
 *
 * Право `canShareScreen` одно на учителя (по умолчанию,
 * `presence.ts#defaultPermissions`) и ученика по разрешению (Э7.4) — кнопка
 * одна и та же для обеих ролей, видимость решает вызывающая сторона
 * (`RoomPage.tsx`).
 *
 * Максимум 1 демонстрация одновременно и приоритет учителю (Э7.2) решает
 * СЕРВЕР по вебхуку `track_published` уже ПОСЛЕ публикации
 * (`rooms/service.ts#handleScreenShareStartedWebhook`) — раньше отменить
 * WebRTC-негоциацию с сервера нельзя, только погасить трек сразу после.
 * `disabled` здесь — не защита, а подсказка: не-учителю, пока кто-то уже
 * делится, кнопка недоступна, чтобы не заставлять его увидеть свою
 * демонстрацию и тут же потерять её. `priority` (учитель — эта проверка
 * его не касается, сервер и так пропустит его демонстрацию вперёд) решает
 * вызывающая сторона (`RoomPage.tsx`, знает `isTeacher`), как и
 * `maxResolution` у `SelfCameraButton`.
 */
export function SelfScreenShareButton({
  priority = false,
  participants = [],
  selfId,
}: {
  priority?: boolean;
  /** Для авто-PiP — кого показать во плавающем окне (закреплён/говорит/первый). */
  participants?: ParticipantSnapshot[];
  selfId?: string;
}) {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const othersSharing = useTracks([Track.Source.ScreenShare], { onlySubscribed: false }).some(
    (t) => t.participant.identity !== localParticipant.identity,
  );
  const blocked = !isScreenShareEnabled && othersSharing && !priority;

  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const cameraTrackByIdentity = new Map(cameraTracks.map((t) => [t.participant.identity, t]));
  const speakingIds = new Set(useSpeakingParticipants().map((p) => p.identity));
  const pipTarget = useMemo(
    () => pickPipTarget(participants, selfId, cameraTrackByIdentity, speakingIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [participants, selfId, cameraTracks, speakingIds],
  );
  const pipVideoRef = useRef<HTMLVideoElement>(null);

  async function toggle() {
    if (isScreenShareEnabled) {
      await localParticipant.setScreenShareEnabled(false);
      if (document.pictureInPictureElement === pipVideoRef.current) {
        await document.exitPictureInPicture().catch(() => undefined);
      }
      return;
    }
    await localParticipant.setScreenShareEnabled(
      true,
      {
        audio: false,
        resolution: DOCUMENT_SCREEN_SHARE_PRESET.resolution,
        contentHint: "detail",
      },
      { screenShareEncoding: DOCUMENT_SCREEN_SHARE_PRESET.encoding },
    );
    // Запрос PiP — в этом же клик-хендлере (после await), не в отдельном
    // эффекте: браузер требует user activation из реального жеста, а
    // эффект сработал бы уже вне его. Нет собеседника с включённой
    // камерой или браузер не поддерживает PiP — просто тихо пропускаем,
    // демонстрация от этого не зависит (§1.2 ТЗ).
    if (pipVideoRef.current && document.pictureInPictureEnabled) {
      try {
        await pipVideoRef.current.requestPictureInPicture();
        toast.info("Включена картинка в картинке — виден собеседник, пока вы делитесь экраном");
      } catch {
        /* активация истекла/браузер не поддерживает — молча пропускаем */
      }
    }
  }

  return (
    <>
      {/* Скрытый видеоэлемент — источник PiP. Не завязан на
          `isScreenShareEnabled`: должен уже играть в момент клика (см.
          комментарий в `toggle`), иначе `requestPictureInPicture()`
          бросит исключение (пустой кадр). */}
      {pipTarget ? (
        <VideoTrack
          ref={pipVideoRef}
          trackRef={pipTarget}
          muted
          autoPlay
          playsInline
          className="pointer-events-none fixed bottom-0 right-0 -z-50 size-px opacity-0"
        />
      ) : null}
      <RoomControlButton
        tone="action"
        active={isScreenShareEnabled}
        activeIcon={MonitorX}
        inactiveIcon={MonitorUp}
        activeLabel="Остановить демонстрацию"
        inactiveLabel="Демонстрация экрана"
        onToggle={toggle}
        disabled={blocked}
        title={blocked ? "Кто-то уже демонстрирует экран" : undefined}
        caption="Экран"
      />
    </>
  );
}
