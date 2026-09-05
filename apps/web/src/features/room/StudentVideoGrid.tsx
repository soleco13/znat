import { useTracks, VideoTrack } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Pin } from "lucide-react";
import type { LessonMode, ParticipantSnapshot } from "@school/shared";

import { UserAvatar } from "@/shared/ui/avatar";
import { MicStatusIcon } from "./MicControls.js";

/**
 * Сетка видео учеников (Э6.2, §5.2/§5.3 ТЗ) — до `MAX_VISIBLE_STUDENT_VIDEOS`
 * (см. `VideoSubscriptions.tsx`) реальных видео, остальные ученики —
 * маленький кружок с инициалом + индикатор микрофона, видео для них не
 * подписано вовсе. Кто именно попадает в «видимые» и подписку на его трек
 * решает `VideoSubscriptionManager` — этот компонент только читает уже
 * подписанные треки (`useTracks` без `onlySubscribed: false`, дефолт хука —
 * `true`) и рендерит; сам он ничего не подписывает и не отписывает. Поэтому
 * для режимов `lecture`/`assignment` (Э6.4) отдельного условия здесь нет —
 * `VideoSubscriptionManager` просто не подписывает никого из учеников,
 * `visible` сам получается пустым.
 *
 * `mode` (Э6.4) используется ТОЛЬКО для формы отображения: в `spotlight`
 * («Опрос/у доски», §5.3 ТЗ — «1 ученик крупно») видимых и так не больше
 * одного (гарантирует `computeVisibleStudentIds`), но сеточная плитка
 * `grid-cols-3` рисовала бы его маленьким, поэтому рендерим единственную
 * видимую плитку крупно, во всю ширину колонки.
 *
 * Полный список учеников идёт из `participants` (WS presence-снапшот,
 * уже есть у `RoomPage`), а не из LiveKit — нужен состав ВСЕХ учеников
 * урока, включая тех, кто ещё не опубликовал видео (для них — просто
 * аватар); `useTracks` знает только про тех, кто уже что-то опубликовал.
 * `s.pinned` (Э6.3) читается из того же снапшота — только для бейджа 📌 на
 * плитке, сам выбор видимых по этому полю уже сделал `VideoSubscriptionManager`.
 */
export function StudentVideoGrid({
  participants,
  mode,
}: {
  participants: ParticipantSnapshot[];
  mode: LessonMode;
}) {
  const videoTracks = useTracks([Track.Source.Camera]);
  const videoByUserId = new Map(videoTracks.map((t) => [t.participant.identity, t]));

  const students = participants.filter((p) => p.role === "student");
  if (students.length === 0) return null;

  const visible = students.filter((s) => videoByUserId.has(s.userId));
  const hidden = students.filter((s) => !videoByUserId.has(s.userId));

  return (
    <div className="mb-4">
      {visible.length > 0 && (
        <div className={mode === "spotlight" ? "grid grid-cols-1" : "grid grid-cols-3 gap-2"}>
          {visible.map((s) => (
            <div
              key={s.userId}
              className={`relative overflow-hidden rounded-lg border border-border bg-slate-900 ${mode === "spotlight" ? "aspect-video max-w-md" : "aspect-video"}`}
            >
              <VideoTrack trackRef={videoByUserId.get(s.userId)!} className="h-full w-full object-cover" />
              <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">
                {s.pinned ? <Pin className="size-3" aria-hidden /> : null}
                {s.fullName}
              </span>
            </div>
          ))}
        </div>
      )}
      {hidden.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {hidden.map((s) => (
            <div
              key={s.userId}
              title={s.fullName}
              className="flex items-center gap-1.5 rounded-pill border border-border bg-card px-2 py-1 text-xs"
            >
              <UserAvatar name={s.fullName} size={20} />
              <MicStatusIcon userId={s.userId} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
