import { useTracks, VideoTrack } from "@livekit/components-react";
import { Track } from "livekit-client";
import type { ParticipantSnapshot } from "@school/shared";
import { MicStatusIcon } from "./MicControls.js";

/**
 * Сетка видео учеников (Э6.2, §5.2/§5.3 ТЗ) — до `MAX_VISIBLE_STUDENT_VIDEOS`
 * (см. `VideoSubscriptions.tsx`) реальных видео, остальные ученики —
 * маленький кружок с инициалом + индикатор микрофона, видео для них не
 * подписано вовсе. Кто именно попадает в «видимые» и подписку на его трек
 * решает `VideoSubscriptionManager` (Э6.2) — этот компонент только читает
 * уже подписанные треки (`useTracks` без `onlySubscribed: false`, дефолт
 * хука — `true`) и рендерит; сам он ничего не подписывает и не отписывает.
 *
 * Полный список учеников идёт из `participants` (WS presence-снапшот,
 * уже есть у `RoomPage`), а не из LiveKit — нужен состав ВСЕХ учеников
 * урока, включая тех, кто ещё не опубликовал видео (для них — просто
 * аватар); `useTracks` знает только про тех, кто уже что-то опубликовал.
 * `s.pinned` (Э6.3) читается из того же снапшота — только для бейджа 📌 на
 * плитке, сам выбор видимых по этому полю уже сделал `VideoSubscriptionManager`.
 */
export function StudentVideoGrid({ participants }: { participants: ParticipantSnapshot[] }) {
  const videoTracks = useTracks([Track.Source.Camera]);
  const videoByUserId = new Map(videoTracks.map((t) => [t.participant.identity, t]));

  const students = participants.filter((p) => p.role === "student");
  if (students.length === 0) return null;

  const visible = students.filter((s) => videoByUserId.has(s.userId));
  const hidden = students.filter((s) => !videoByUserId.has(s.userId));

  return (
    <div className="mb-4">
      {visible.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {visible.map((s) => (
            <div key={s.userId} className="relative aspect-video overflow-hidden rounded border bg-slate-900">
              <VideoTrack trackRef={videoByUserId.get(s.userId)!} className="h-full w-full object-cover" />
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-xs text-white">
                {s.pinned && "📌 "}
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
              className="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-1 text-xs"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-300 text-[10px] font-medium">
                {s.fullName.slice(0, 1).toUpperCase()}
              </span>
              <MicStatusIcon userId={s.userId} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
