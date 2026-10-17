import type { DeviceCheckResult } from "./DeviceCheckScreen.js";

/**
 * Гость проходит проверку устройств ДО входа в урок (2026-10-17): на экране
 * входа по ссылке — а закрыт ли вход, выясняется уже после неё. Результат
 * проверки едет в комнату через state навигации, и комната не показывает
 * экран проверки второй раз.
 */
export interface DeviceCheckHandoff {
  at: number;
  result: DeviceCheckResult;
}

/** Старше — не считаем: state живёт в истории браузера и переживает F5. */
const MAX_AGE_MS = 10 * 60 * 1000;

export function readDeviceCheckHandoff(state: unknown): DeviceCheckResult | null {
  const h = (state as { deviceCheck?: DeviceCheckHandoff } | null)?.deviceCheck;
  if (!h || typeof h.at !== "number" || Date.now() - h.at > MAX_AGE_MS) return null;
  return h.result;
}
