import { useParticipants } from "@livekit/components-react";

/**
 * Точка присутствия участника (Э1) с подсветкой кольцом, когда LiveKit
 * считает его активным говорящим (Э2.6). Должна рендериться только внутри
 * `<LiveKitRoom>`.
 *
 * Читает `isSpeaking` напрямую со свойства найденного `Participant`, а не
 * через хук `useIsSpeaking()` — тот требует уже разрешённого участника
 * (`useEnsureParticipant` бросает исключение, если его нет) и упал бы, пока
 * соответствующий `Participant` ещё не появился в LiveKit-комнате (недолгая,
 * но реальная гонка сразу после входа). `useParticipants()` уже
 * ре-рендерит при `ActiveSpeakersChanged`, так что чтение свойства остаётся
 * реактивным.
 */
export function ParticipantPresenceDot({ userId, connected }: { userId: string; connected: boolean }) {
  const participants = useParticipants();
  const match = participants.find((p) => p.identity === userId);
  const speaking = match?.isSpeaking ?? false;
  return (
    <span
      className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-slate-300"} ${
        speaking ? "ring-2 ring-green-400 ring-offset-1" : ""
      }`}
    />
  );
}
