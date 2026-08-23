import { EventEmitter } from "node:events";
import type { ServerRoomMessage } from "@school/shared";

/** Мост между бизнес-логикой (service.ts) и WS-раздачей (ws.ts) внутри модуля. */
export const roomEvents = new EventEmitter();
roomEvents.setMaxListeners(0);

export function emitRoomEvent(lessonId: string, message: ServerRoomMessage): void {
  roomEvents.emit(lessonId, message);
}
