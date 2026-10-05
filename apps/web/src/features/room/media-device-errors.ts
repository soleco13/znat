import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";

import { errorFields, track } from "@/shared/telemetry";
import { toast } from "@/shared/ui/sonner";

type DeviceKind = "microphone" | "camera";

const NAME: Record<DeviceKind, { what: string; to: string; it: string; ending: string }> = {
  microphone: { what: "микрофон", to: "микрофону", it: "Микрофон", ending: "" },
  camera: { what: "камеру", to: "камере", it: "Камера", ending: "а" },
};

/** Что человеку сделать, чтобы устройство заработало, — по имени ошибки `getUserMedia`. */
function deviceErrorMessage(kind: DeviceKind, err: unknown): string {
  const { what, to, it, ending } = NAME[kind];
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return `Браузер не дал доступ к ${to} — разрешите доступ в настройках сайта (значок слева от адреса)`;
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return `${it} занят${ending} другой программой — закройте её и попробуйте ещё раз`;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return `${it} не найден${ending} — подключите и попробуйте ещё раз`;
  }
  return `Не удалось включить ${what} — попробуйте ещё раз`;
}

/**
 * Не включились микрофон или камера. Раньше отказ уходил в никуда: кнопка
 * просто не переключалась, и ученик не понимал, почему его не слышно.
 * Сообщение — о том, что сделать, а не о технике (правило урока).
 */
export function reportMediaDeviceError(kind: DeviceKind, err: unknown): void {
  track("media_device_failed", { kind, ...errorFields(err) });
  showMediaDeviceError(kind, err);
}

function showMediaDeviceError(kind: DeviceKind, err: unknown): void {
  toast.error(deviceErrorMessage(kind, err), { position: "top-center", duration: 8000, id: `media-device-${kind}` });
}

/**
 * Микрофон или камера не включились при подключении к уроку (их включает сам
 * `<LiveKitRoom>` по выбору с экрана проверки): устройство заняла другая
 * программа, его отключили, браузер отозвал доступ. Раньше это уходило
 * только в телеметрию — человек входил с выключенным микрофоном и не знал
 * почему. Плашка та же, что у кнопок (один id — не дублируется); в лог эти
 * ошибки пишет `MediaTelemetry`.
 */
export function MediaDeviceErrorNotice(): null {
  const room = useRoomContext();
  useEffect(() => {
    const onError = (err: Error, kind?: MediaDeviceKind) => {
      if (kind === "audioinput") showMediaDeviceError("microphone", err);
      else if (kind === "videoinput") showMediaDeviceError("camera", err);
    };
    room.on(RoomEvent.MediaDevicesError, onError);
    return () => {
      room.off(RoomEvent.MediaDevicesError, onError);
    };
  }, [room]);
  return null;
}
