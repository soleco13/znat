import { useIsSpeaking, useLocalParticipant, useParticipants } from "@livekit/components-react";
import { Mic, MicOff } from "lucide-react";

import { RoomControlButton } from "./RoomControlButton.js";

/** Кнопка «мьют себя» (Э2.5) — для любого участника с правом `canSpeak`. */
export function SelfMicButton() {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const speaking = useIsSpeaking(localParticipant);
  return (
    <RoomControlButton
      active={isMicrophoneEnabled}
      activeIcon={Mic}
      inactiveIcon={MicOff}
      activeLabel="Выключить микрофон"
      inactiveLabel="Включить звук"
      speaking={speaking && isMicrophoneEnabled}
      onToggle={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
      caption="Микрофон"
    />
  );
}

/** Значок текущего состояния микрофона участника — из LiveKit-комнаты, не из presence. */
export function MicStatusIcon({ userId }: { userId: string }) {
  const participants = useParticipants();
  const match = participants.find((p) => p.identity === userId);
  if (!match || !match.isMicrophoneEnabled) return null;
  return <Mic className="size-3.5 text-success" aria-label="Микрофон включён" />;
}
