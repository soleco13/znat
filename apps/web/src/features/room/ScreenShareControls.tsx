import { useLocalParticipant, useTracks } from "@livekit/components-react";
import { Track, VideoPreset } from "livekit-client";
import { MonitorUp, MonitorX } from "lucide-react";

import { RoomControlButton } from "./RoomControlButton.js";

/**
 * Э7.1, §5.2 ТЗ: «1080p@5fps для документов» — дефолт, когда параметры
 * школы (§10.10 ТЗ, запрос 2026-09-14) ещё не загружены или явно не заданы.
 * Битрейт 1 Мбит/с — ОЦЕНКА, не факт из ТЗ/LiveKit: `ScreenSharePresets.
 * h1080fps15` берёт 2.5 Мбит/с на 15 fps, при втрое меньшем fps (5)
 * пропорционально вышло бы ~0.83 Мбит/с, округлено чуть вверх ради чёткости
 * текста документа (низкий fps не должен экономить на резкости кадра).
 *
 * Э12.7 UX: выбор «документ / видео» из панели убран (ученики и пожилые
 * учителя не должны выбирать fps/битрейт вручную на КАЖДОМ показе) — но
 * админ школы теперь может задать разрешение/fps ОДИН раз в «Параметрах»
 * (`toScreenShareEncoding`, `media-quality.ts`), а не за каждым учителем.
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
export function SelfScreenShareButton({
  priority = false,
  encoding = DOCUMENT_SCREEN_SHARE_PRESET,
  onScreenShareStarted,
  onScreenShareStopped,
}: {
  priority?: boolean;
  /** Параметры школы (запрос 2026-09-14) — разрешение/битрейт/fps демонстрации, считается `toScreenShareEncoding` в `RoomPage.tsx`. По умолчанию — профиль «документ» (см. `DOCUMENT_SCREEN_SHARE_PRESET`). */
  encoding?: VideoPreset;
  /** Доп. — авто-PiP (Толк-кнопка, `PictureInPictureButton`): вызывается
   *  сразу после успешного старта демонстрации, из ТОГО ЖЕ клик-хендлера
   *  (иначе браузер может отказать `requestPictureInPicture()` без
   *  свежего user activation — см. докстринг `PictureInPictureButton`). */
  onScreenShareStarted?: () => void;
  /** Закрыть PiP-окно сразу по клику «Стоп» из ГЛАВНОЙ панели (не только
   *  из тулбара внутри самого PiP, см. `ScreenShareAutoPip`) — не ждать
   *  `isScreenShareEnabled` из LiveKit-негоциации. */
  onScreenShareStopped?: () => void;
}) {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const othersSharing = useTracks([Track.Source.ScreenShare], { onlySubscribed: false }).some(
    (t) => t.participant.identity !== localParticipant.identity,
  );
  const blocked = !isScreenShareEnabled && othersSharing && !priority;

  async function toggle() {
    if (isScreenShareEnabled) {
      onScreenShareStopped?.();
      await localParticipant.setScreenShareEnabled(false);
      return;
    }
    await localParticipant.setScreenShareEnabled(
      true,
      {
        audio: false,
        resolution: encoding.resolution,
        contentHint: "detail",
      },
      { screenShareEncoding: encoding.encoding },
    );
    onScreenShareStarted?.();
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
