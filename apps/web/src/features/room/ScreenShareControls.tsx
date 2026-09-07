import { useLocalParticipant, useTracks } from "@livekit/components-react";
import { Track, VideoPreset } from "livekit-client";
import { MonitorUp, MonitorX } from "lucide-react";

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
export function SelfScreenShareButton({ priority = false }: { priority?: boolean }) {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const othersSharing = useTracks([Track.Source.ScreenShare], { onlySubscribed: false }).some(
    (t) => t.participant.identity !== localParticipant.identity,
  );
  const blocked = !isScreenShareEnabled && othersSharing && !priority;

  async function toggle() {
    if (isScreenShareEnabled) {
      await localParticipant.setScreenShareEnabled(false);
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
  }

  return (
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
  );
}
