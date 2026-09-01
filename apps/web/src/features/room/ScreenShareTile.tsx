import { useTracks, VideoTrack } from "@livekit/components-react";
import { Track } from "livekit-client";

/**
 * Плитка демонстрации экрана (Э7.1) — рендерит уже подписанный трек
 * SCREEN_SHARE (подписка на него всегда включена, `VideoSubscriptions.tsx`
 * — не часть лимита на 9 видимых учеников, Э6.2). Максимум 1 демонстрация
 * одновременно гарантирует сервер (Э7.2, `rooms/service.ts#handleScreenShareStartedWebhook`),
 * поэтому `tracks[0]` безопасен — искать «чью именно» демонстрацию
 * показывать не нужно, она всегда ровно одна.
 *
 * Показана крупно, над доской, а не мелкой плиткой в углу (как
 * `TeacherVideoTile`) — демонстрация экрана и есть то, на что сейчас
 * смотрит урок (Э7.3 переводит режим в Лекцию на время демонстрации,
 * §5.3 ТЗ: «доска/слайд на весь экран»).
 */
export function ScreenShareTile() {
  const tracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: true });
  const track = tracks[0];
  if (!track) return null;

  return (
    <div className="mb-4 overflow-hidden rounded border bg-black">
      <VideoTrack trackRef={track} className="max-h-[70vh] w-full object-contain" />
    </div>
  );
}
