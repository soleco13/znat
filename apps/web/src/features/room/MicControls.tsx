import { useIsSpeaking, useLocalParticipant, useParticipants } from "@livekit/components-react";
import { Mic, MicOff } from "lucide-react";

import { RoomControlButton, type RoomControlVariant } from "./RoomControlButton.js";

/**
 * Кнопка «мьют себя» (Э2.5) — для любого участника с правом `canSpeak`.
 * Юзабилити-правка: без права кнопка не пропадает совсем (человек не должен
 * гадать, немой он или сломалось), а становится disabled с объяснением
 * в подсказке — `disabledReason`, обычно «поднимите руку».
 */
export function SelfMicButton({
  disabled = false,
  disabledReason,
  variant,
  onOpenSettings,
}: {
  disabled?: boolean;
  disabledReason?: string;
  variant?: RoomControlVariant;
  onOpenSettings?: () => void;
}) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const speaking = useIsSpeaking(localParticipant);
  return (
    <RoomControlButton
      active={isMicrophoneEnabled}
      activeIcon={Mic}
      inactiveIcon={MicOff}
      activeLabel="Микрофон"
      inactiveLabel="Включить звук"
      speaking={speaking && isMicrophoneEnabled}
      onToggle={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
      caption="Микрофон"
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      variant={variant}
      onOpenSettings={onOpenSettings}
      settingsLabel="Выбрать микрофон"
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
