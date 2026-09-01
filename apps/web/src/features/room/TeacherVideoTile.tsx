import { useState } from "react";
import { useTracks, VideoTrack } from "@livekit/components-react";
import { Track } from "livekit-client";

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
 * Плитка камеры учителя (Э5.1, UI-контролы Э5.3) — видна всем участникам
 * урока. Источник CAMERA в LiveKit-гранте выдаётся только роли teacher/admin
 * (`media/service.ts#buildPublishGrant`), поэтому любой опубликованный трек
 * камеры в комнате — это и есть учитель; искать участника по identity не
 * нужно. Стоп-лист Э5: плитка ровно одна, сетки нет (камер учеников не
 * будет ни у кого до Э6).
 *
 * «Учитель прячется одной кнопкой» (результат Э5.3) — это `SelfCameraButton`
 * из Э5.1: выключение камеры останавливает публикацию трека, эта плитка
 * реагирует на исчезновение трека сама (условие `if (!teacherTrack)` ниже) —
 * отдельного «режима «только доска»» как второго переключателя не заводили,
 * чтобы не плодить два разных выключателя одного и того же состояния.
 * Закрепление и сворачивание — состояние КАЖДОГО зрителя отдельно (не
 * синхронизируется по Y.Doc/WS): один ученик может свернуть плитку, не
 * трогая экран остальных. Не сохраняется между презентациями/уроками —
 * localStorage запрещён (§ «Железные правила» CLAUDE.md), обычный React-стейт.
 */
export function TeacherVideoTile() {
  const [collapsed, setCollapsed] = useState(false);
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const teacherTrack = tracks[0];
  if (!teacherTrack) return null;

  const micOn = teacherTrack.participant.isMicrophoneEnabled;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Развернуть видео учителя"
        className={`fixed ${CORNER_CLASSES[corner]} z-10 flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-lg shadow-lg`}
      >
        {micOn ? "🎙️" : "📷"}
      </button>
    );
  }

  return (
    <div
      className={`fixed ${CORNER_CLASSES[corner]} z-10 w-48 overflow-hidden rounded-lg border border-slate-700 bg-black shadow-lg`}
    >
      <div className="flex items-center justify-end gap-1 bg-black/60 p-1">
        <button
          onClick={() => setCorner((c) => NEXT_CORNER[c])}
          title="Закрепить в другом углу"
          className="rounded px-1 text-xs text-white/80 hover:bg-white/10"
        >
          📌
        </button>
        <button
          onClick={() => setCollapsed(true)}
          title="Свернуть видео учителя"
          className="rounded px-1 text-xs text-white/80 hover:bg-white/10"
        >
          –
        </button>
      </div>
      <VideoTrack trackRef={teacherTrack} className="h-full w-full object-cover" />
    </div>
  );
}
