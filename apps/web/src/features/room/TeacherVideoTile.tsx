import { useTracks, VideoTrack } from "@livekit/components-react";
import { Track } from "livekit-client";

/**
 * Плитка камеры учителя (Э5.1) — видна всем участникам урока. Источник
 * CAMERA в LiveKit-гранте выдаётся только роли teacher/admin
 * (`media/service.ts#buildPublishGrant`), поэтому любой опубликованный трек
 * камеры в комнате — это и есть учитель; искать участника по identity не
 * нужно. Стоп-лист Э5: плитка ровно одна, сетки нет (камер учеников не
 * будет ни у кого до Э6).
 */
export function TeacherVideoTile() {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const teacherTrack = tracks[0];
  if (!teacherTrack) return null;

  return (
    <div className="fixed bottom-4 right-4 z-10 w-48 overflow-hidden rounded-lg border border-slate-700 bg-black shadow-lg">
      <VideoTrack trackRef={teacherTrack} className="h-full w-full object-cover" />
    </div>
  );
}
