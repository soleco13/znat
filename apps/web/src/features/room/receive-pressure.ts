import { useSyncExternalStore } from "react";

/**
 * «Приём не успевает»: звук собеседника копится в буфере (`AudioLagGuard`
 * видит задержку воспроизведения выше нормы), значит входящие пакеты
 * приходят пачками — узкий или забитый входящий канал либо перегруженное
 * устройство. Пока признак стоит, чужие камеры идут нижним слоем и реже
 * (`PoorLinkMedia`), как при перегрузке своего процессора: звук важнее.
 *
 * Урок 2026-10-19 (Елена): задержка звука 0,7–1 с весь урок, видео замирало
 * ~10 с в минуту, а LiveKit в эти моменты оценивал входящий канал Елены в
 * 75–290 кбит/с при очереди 0,4–0,5 с (`send side bwe: congestion state
 * change`). Камера собеседницы шла 15 кадр/с и сама забивала этот канал.
 *
 * Задержка у одного собеседника при нормальной у другого — это канал того
 * отправителя, а не свой приём: тогда признак не ставится (`AudioLagGuard`).
 * Держится `HOLD_MS` после последнего замера с задержкой — выход не дёргается.
 */
const HOLD_MS = 120_000;

let until = 0;
let active = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === active) return;
  active = next;
  for (const l of listeners) l();
}

/** Звук собеседника снова с задержкой — продлить признак. */
export function markReceivePressure(now = Date.now()): void {
  until = now + HOLD_MS;
  set(true);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    if (Date.now() >= until) set(false);
  }, HOLD_MS + 50);
}

export function receivePressure(): boolean {
  return active;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReceivePressure(): boolean {
  return useSyncExternalStore(subscribe, receivePressure);
}
