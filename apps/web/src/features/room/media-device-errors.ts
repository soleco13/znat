import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import { MicOff, VideoOff } from "lucide-react";

import { errorFields, track } from "@/shared/telemetry";
import { notify } from "@/shared/ui/notify";

type DeviceKind = "microphone" | "camera";

const NAME: Record<DeviceKind, { what: string; to: string; it: string; ending: string }> = {
  microphone: { what: "микрофон", to: "микрофону", it: "Микрофон", ending: "" },
  camera: { what: "камеру", to: "камере", it: "Камера", ending: "а" },
};

/** Что случилось и что человеку сделать, чтобы устройство заработало, — по имени ошибки `getUserMedia`. */
function deviceErrorMessage(kind: DeviceKind, err: unknown): { title: string; text: string } {
  const { what, to, it, ending } = NAME[kind];
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      title: `Браузер не дал доступ к ${to}`,
      text: "Разрешите: значок слева от адреса сайта",
    };
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return { title: `${it} занят${ending} другой программой`, text: "Закройте её и попробуйте ещё раз" };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return { title: `${it} не найден${ending}`, text: "Подключите и попробуйте ещё раз" };
  }
  return { title: `Не удалось включить ${what}`, text: "Попробуйте ещё раз" };
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
  const { title, text } = deviceErrorMessage(kind, err);
  notify(title, { id: `media-device-${kind}`, icon: kind === "camera" ? VideoOff : MicOff, text, duration: 8_000 });
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
