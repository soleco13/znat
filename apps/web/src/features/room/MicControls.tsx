import { useLocalParticipant, useParticipants } from "@livekit/components-react";
import { Mic, MicOff } from "lucide-react";

import { Button } from "@/shared/ui/button";

/** Кнопка «мьют себя» (Э2.5) — для любого участника с правом `canSpeak`. */
export function SelfMicButton() {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  return (
    <Button
      variant={isMicrophoneEnabled ? "outline" : "secondary"}
      size="sm"
      onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
    >
      {isMicrophoneEnabled ? <MicOff aria-hidden /> : <Mic aria-hidden />}
      {isMicrophoneEnabled ? "Заглушить микрофон" : "Включить микрофон"}
    </Button>
  );
}

/** Значок текущего состояния микрофона участника — из LiveKit-комнаты, не из presence. */
export function MicStatusIcon({ userId }: { userId: string }) {
  const participants = useParticipants();
  const match = participants.find((p) => p.identity === userId);
  if (!match || !match.isMicrophoneEnabled) return null;
  return <Mic className="size-3.5 text-success" aria-label="Микрофон включён" />;
}
