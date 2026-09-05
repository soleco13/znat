import { useConnectionState } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";

const STATUS_LABEL: Record<ConnectionState, string> = {
  [ConnectionState.Disconnected]: "аудио отключено",
  [ConnectionState.Connecting]: "аудио подключается…",
  [ConnectionState.Connected]: "аудио на связи",
  [ConnectionState.Reconnecting]: "аудио переподключается…",
  [ConnectionState.SignalReconnecting]: "аудио переподключается…",
};

/** Читает состояние из контекста <LiveKitRoom> — должен рендериться внутри него. */
export function MediaAudioStatus() {
  const state = useConnectionState();
  return <span className="text-xs text-muted-foreground">{STATUS_LABEL[state]}</span>;
}
