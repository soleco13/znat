import { EventEmitter } from "node:events";
import type { ServerRoomMessage } from "@school/shared";

/** Мост между бизнес-логикой (service.ts) и WS-раздачей (ws.ts) внутри модуля. */
export const roomEvents = new EventEmitter();
roomEvents.setMaxListeners(0);

type AnyRoomEventListener = (lessonId: string, message: ServerRoomMessage) => void;

/**
 * Слушатели ВСЕХ событий всех уроков — журнал экспериментальной записи
 * (recordings, docs/experimental-recording.md). Ошибка слушателя не должна
 * помешать раздаче события участникам — глушим её здесь.
 */
const anyListeners = new Set<AnyRoomEventListener>();

export function onAnyRoomEvent(listener: AnyRoomEventListener): () => void {
  anyListeners.add(listener);
  return () => anyListeners.delete(listener);
}

export function emitRoomEvent(lessonId: string, message: ServerRoomMessage): void {
  roomEvents.emit(lessonId, message);
  for (const listener of anyListeners) {
    try {
      listener(lessonId, message);
    } catch {
      // журнал не важнее урока
    }
  }
}

/**
 * Адресная пересылка окна связи участника (2026-10-24): ключ
 * `${lessonId}:${participantId}` — сообщение получает только адресат, мимо
 * общей рассылки урока и журнала записи.
 */
export const statsRelay = new EventEmitter();
statsRelay.setMaxListeners(0);
