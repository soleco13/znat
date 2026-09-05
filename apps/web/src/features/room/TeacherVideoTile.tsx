import { useState } from "react";
import { useTracks, VideoTrack } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Camera, Mic, Minus, Move } from "lucide-react";

type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

const CORNER_CLASSES: Record<Corner, string> = {
  "bottom-right": "bottom-4 right-4",
  "bottom-left": "bottom-4 left-4",
  "top-right": "top-4 right-4",
  "top-left": "top-4 left-4",
};
const NEXT_CORNER: Record<Corner, Corner> = {
  "bottom-right": "bottom-left",
  "bottom-left": "top-left",
  "top-left": "top-right",
  "top-right": "bottom-right",
};

/**
 * Плитка камеры учителя (Э5.1, UI-контролы Э5.3) — видна всем участникам.
 * Ищем участника с ролью teacher/admin по LiveKit-атрибуту `role`.
 * Закрепление и сворачивание — состояние каждого зрителя отдельно, обычный
 * React-стейт (localStorage запрещён).
 */
export function TeacherVideoTile() {
  const [collapsed, setCollapsed] = useState(false);
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const teacherTrack = tracks.find(
    (t) => t.participant.attributes.role === "teacher" || t.participant.attributes.role === "admin",
  );
  if (!teacherTrack) return null;

  const micOn = teacherTrack.participant.isMicrophoneEnabled;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Развернуть видео учителя"
        className={`fixed ${CORNER_CLASSES[corner]} z-20 flex size-11 items-center justify-center rounded-full border border-border bg-foreground text-background shadow-lg`}
      >
        {micOn ? <Mic className="size-4" aria-hidden /> : <Camera className="size-4" aria-hidden />}
      </button>
    );
  }

  return (
    <div
      className={`fixed ${CORNER_CLASSES[corner]} z-20 w-52 overflow-hidden rounded-xl border border-border bg-black shadow-lg`}
    >
      <div className="flex items-center justify-end gap-1 bg-black/50 px-1.5 py-1">
        <button
          onClick={() => setCorner((c) => NEXT_CORNER[c])}
          title="Закрепить в другом углу"
          className="rounded p-1 text-white/80 transition-colors hover:bg-white/10"
        >
          <Move className="size-3.5" aria-hidden />
        </button>
        <button
          onClick={() => setCollapsed(true)}
          title="Свернуть видео учителя"
          className="rounded p-1 text-white/80 transition-colors hover:bg-white/10"
        >
          <Minus className="size-3.5" aria-hidden />
        </button>
      </div>
      <VideoTrack trackRef={teacherTrack} className="aspect-video w-full object-cover" />
    </div>
  );
}
