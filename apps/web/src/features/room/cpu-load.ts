import { useEffect, useSyncExternalStore } from "react";
import { useRoomContext } from "@livekit/components-react";

import { track } from "../../shared/telemetry.js";
import { RECEIVE_LOW_LEVEL, cpuLoadLevel, startCpuLoadAdapter, subscribeCpuLoadLevel } from "./cpu-load-engine.js";

export { cpuConstrainedRecently } from "./cpu-load-engine.js";

/** Своё устройство не справляется настолько, что чужие камеры стоит принимать нижним слоем. */
export function useCpuHeavy(): boolean {
  return useSyncExternalStore(subscribeCpuLoadLevel, cpuLoadLevel) >= RECEIVE_LOW_LEVEL;
}

/**
 * Автомат нагрузки своего устройства на уроке (`cpu-governor.ts` решает,
 * `cpu-load-engine.ts` применяет к своей камере и демонстрации, приём чужих
 * камер — `PoorLinkMedia`). На уроке ничего не показывается: переключения
 * молча, каждая смена ступени и переоткрытие камеры — в лог
 * (`media_cpu_adapt`).
 */
export function CpuLoadAdapter() {
  const room = useRoomContext();

  useEffect(() => {
    const base = () => ({ livekitRoom: room.name || null, identity: room.localParticipant.identity || null });
    return startCpuLoadAdapter(room, {
      onChange: ({ decision, sample, camera, remoteVideos }) =>
        track("media_cpu_adapt", {
          ...base(),
          level: decision.level,
          state: decision.state,
          reason: decision.reason,
          audioCapture: sample.audioCapture === null ? null : Math.round(sample.audioCapture * 100) / 100,
          videoCpu: sample.videoCpuLimited,
          pressure: sample.pressure,
          sharing: sample.sharing,
          targetHeight: camera.targetHeight,
          cameraHeight: camera.height,
          cameraFps: camera.fps,
          cameraLayers: camera.layers,
          encoder: camera.encoder,
          remoteVideos,
          cores: navigator.hardwareConcurrency ?? null,
          hidden: document.visibilityState === "hidden",
        }),
      onReopen: (result, low) => track("media_cpu_adapt", { ...base(), reason: low ? "camera_reopen_low" : "camera_reopen_target", result }),
    });
  }, [room]);

  return null;
}
