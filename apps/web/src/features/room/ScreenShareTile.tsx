import { useState } from "react";
import { isTrackReference, useTracks, VideoTrack } from "@livekit/components-react";
import { Track } from "livekit-client";

import { MediaLoader } from "@/shared/ui/media-loader";

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
 * 2026-09-15: контейнер (рамка + фон `bg-card`) всегда занимает ВЕСЬ
 * выделенный слот (`h-full w-full`) — так же, как `Board`, у которого
 * рядом с лентой камер тот же слот заполняется целиком (бесконечный
 * canvas без своих пропорций). Раньше (2026-09-11) рамка обнимала САМО
 * видео (`max-w/max-h` на `<video>`), из-за чего при несовпадении
 * пропорций демонстрации и слота плитка визуально оказывалась заметно
 * меньше доски — пустое пространство вокруг видео сливалось с фоном
 * страницы и не выглядело частью плитки. Теперь `object-contain` сидит
 * на самом `<video>` внутри уже полноразмерной рамки — контейнер
 * одинаков с доской на любом устройстве, а letterbox-поля (если
 * пропорции не совпали) закрашены тем же `bg-card`, что и рамка, а не
 * чёрным/белым. Обрезка контента (`object-cover`) сознательно не
 * используется — демонстрация часто документ или таблица, где
 * обрезанный край теряет данные.
 */
export function ScreenShareTile() {
  // Все опубликованные, не только подписанные: пока подписка и первый кадр
  // идут (на плохой связи — десятки секунд), показываем лоадер, а не пустоту.
  const tracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const track = tracks[0];
  const [loadedSid, setLoadedSid] = useState<string | null>(null);
  if (!track || !isTrackReference(track)) return null;
  const sid = track.publication.trackSid;
  // У своей (локальной) демонстрации трек есть сразу; у чужой — после подписки.
  const ready = track.publication.track !== undefined;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      {ready ? (
        <VideoTrack trackRef={track} onLoadedData={() => setLoadedSid(sid)} className="size-full object-contain" />
      ) : null}
      {loadedSid !== sid ? <MediaLoader label="Загружаем демонстрацию экрана…" tone="light" size="lg" /> : null}
    </div>
  );
}
