import { useLocalParticipant, useParticipants } from "@livekit/components-react";

/** Кнопка «мьют себя» (Э2.5) — свободна для любого участника с правом `canSpeak`, не требует учителя. */
export function SelfMicButton() {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  return (
    <button
      onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
      className={`rounded border px-3 py-1 text-sm ${isMicrophoneEnabled ? "" : "border-red-300 text-red-700"}`}
    >
      {isMicrophoneEnabled ? "Заглушить микрофон" : "Включить микрофон"}
    </button>
  );
}

/** Значок текущего состояния микрофона участника — читает состояние из LiveKit-комнаты, а не из presence. */
export function MicStatusIcon({ userId }: { userId: string }) {
  const participants = useParticipants();
  const match = participants.find((p) => p.identity === userId);
  if (!match || !match.isMicrophoneEnabled) return null;
  return (
    <span title="Микрофон включён" className="text-green-600">
      🎙️
    </span>
  );
}
