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
 *
 * Без полей по краям и без обрезки (2026-09-11, после жалоб пользователя на
 * оба крайних варианта подряд): рамка/фон висят не на «коробке во весь
 * стейдж», внутри которой при несовпадении пропорций и появлялись полосы
 * (сначала чёрные, потом — светлые), а на САМОМ видео. Элемент `<video>`
 * сохраняет свои пропорции внутри `max-w/max-h`, поэтому граница обнимает
 * картинку вплотную: полей внутри рамки нет в принципе, а содержимое не
 * обрезается (`object-contain`, не `cover` — демонстрация часто документ
 * или таблица, где обрезанный край теряет данные). Масштабируется
 * адаптивно под любой размер стейджа/экрана.
 */
export function ScreenShareTile() {
  const tracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: true });
  const track = tracks[0];
  if (!track) return null;

  return (
    <div className="flex h-full w-full items-center justify-center">
      <VideoTrack
        trackRef={track}
        className="max-h-full max-w-full rounded-xl border border-border object-contain shadow-sm"
      />
    </div>
  );
}
