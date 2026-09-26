import { useParticipants } from "@livekit/components-react";
import { ConnectionQuality } from "livekit-client";
import { Signal, SignalHigh, SignalLow, SignalZero } from "lucide-react";
import type { LucideIcon } from "lucide-react";


/** Как в Толке/Zoom — значок «палочек», не голая точка (см. также
 *  `QUALITY_LABEL` ниже: цвет один на двух уровнях, значок — тоже). */
export const QUALITY_ICON: Record<ConnectionQuality, LucideIcon> = {
  [ConnectionQuality.Excellent]: SignalHigh,
  [ConnectionQuality.Good]: SignalHigh,
  [ConnectionQuality.Poor]: SignalLow,
  [ConnectionQuality.Lost]: SignalZero,
  [ConnectionQuality.Unknown]: Signal,
};

export const QUALITY_COLOR: Record<ConnectionQuality, string> = {
  [ConnectionQuality.Excellent]: "text-success",
  [ConnectionQuality.Good]: "text-success",
  [ConnectionQuality.Poor]: "text-warning",
  [ConnectionQuality.Lost]: "text-destructive",
  [ConnectionQuality.Unknown]: "text-text-3",
};

export const QUALITY_LABEL: Record<ConnectionQuality, string> = {
  [ConnectionQuality.Excellent]: "связь отличная",
  [ConnectionQuality.Good]: "связь хорошая",
  [ConnectionQuality.Poor]: "плохая связь",
  [ConnectionQuality.Lost]: "связь потеряна",
  [ConnectionQuality.Unknown]: "качество связи неизвестно",
};

/**
 * Индикатор качества связи участника (Э2.8, доп. — значок вместо точки, как
 * в Толке) — читает `connectionQuality` прямо со свойства найденного
 * `Participant`, тем же безопасным паттерном, что и
 * `ParticipantPresenceDot`/`MicStatusIcon` (не хук `useConnectionQualityIndicator()`:
 * внутри он через `useEnsureParticipant()` бросает исключение, если участник ещё не
 * появился в LiveKit-комнате — та же гонка, что описана в Э2.6 для `useIsSpeaking()`,
 * проверено чтением исходника `useConnectionQualityIndicator.ts` в node_modules).
 * Значение приходит от сервера LiveKit по всем участникам одинаково (`RoomEvent.ConnectionQualityChanged`
 * входит в набор событий, на которые по умолчанию перерисовывается `useParticipants()` —
 * проверено чтением `allRemoteParticipantRoomEvents` в `@livekit/components-core`), поэтому
 * не требует собственного опроса `getStats()`.
 *
 * `aria-label` прямо на иконке (не `title`) — тот же приём, что у `Hand`/`Pin`
 * в `RoomVideoGrid`: на тач-экране `title` не всплывает, а так смысл виден
 * скринридеру независимо от способа ввода.
 */
export function ConnectionQualityIcon({ userId, className }: { userId: string; className?: string }) {
  const participants = useParticipants();
  const match = participants.find((p) => p.identity === userId);
  const quality = match?.connectionQuality ?? ConnectionQuality.Unknown;
  const Icon = QUALITY_ICON[quality];
  return (
    <Icon
      aria-label={QUALITY_LABEL[quality]}
      className={`size-3.5 shrink-0 ${QUALITY_COLOR[quality]} ${className ?? ""}`}
    />
  );
}
