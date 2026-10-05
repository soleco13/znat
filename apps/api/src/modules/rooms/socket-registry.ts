/**
 * G-04: сколько WS-каналов урока (`/ws`) держит один участник в этом
 * процессе. Без предела вошедший гость открывал сокеты, пока пускал общий
 * лимит запросов, и каждый держал слушатель событий урока и таймер пинга.
 *
 * Новое подключение сверх предела закрывает самое старое. Не отказ новому:
 * после обрыва сети сервер ещё долго считает живым полуоткрытый старый сокет
 * (клиент его уже бросил, см. `useRoomSocket` STALE_AFTER_MS), и отказ
 * оставил бы честного ученика без канала. Самый старый сокет — почти всегда
 * как раз такой мёртвый.
 *
 * Запас 3, а не 1: вторая вкладка того же человека (учитель открыл урок
 * ещё раз) не должна выбивать первую по кругу, и между обрывом и закрытием
 * мёртвого сокета живут оба.
 */
export const MAX_SOCKETS_PER_PARTICIPANT = 3;
/** Сокет вытеснен более новым подключением того же участника. */
export const SUPERSEDED_CLOSE_CODE = 4009;

export interface ClosableSocket {
  close(code?: number, reason?: string): void;
}

const sockets = new Map<string, ClosableSocket[]>();

function key(lessonId: string, participantId: string): string {
  return `${lessonId}:${participantId}`;
}

/**
 * Учесть новый сокет участника. Возвращает вытесненные (старейшие сверх
 * предела) — их закрывает вызывающий кодом SUPERSEDED_CLOSE_CODE. Синхронно:
 * одновременные подключения не проскочат мимо предела.
 */
export function registerSocket(lessonId: string, participantId: string, socket: ClosableSocket): ClosableSocket[] {
  const k = key(lessonId, participantId);
  const list = sockets.get(k) ?? [];
  list.push(socket);
  const evicted = list.length > MAX_SOCKETS_PER_PARTICIPANT ? list.splice(0, list.length - MAX_SOCKETS_PER_PARTICIPANT) : [];
  sockets.set(k, list);
  return evicted;
}

/**
 * Забыть закрытый сокет. `true` — у участника больше нет сокетов в этом
 * процессе: только тогда его можно отмечать отключённым. Иначе поздно
 * закрывшийся мёртвый сокет гасил «на связи» у живого переподключения до
 * следующего пинга (до 20 с участник пропадал из сетки).
 */
export function unregisterSocket(lessonId: string, participantId: string, socket: ClosableSocket): boolean {
  const k = key(lessonId, participantId);
  const list = sockets.get(k);
  if (!list) return true;
  const index = list.indexOf(socket);
  if (index !== -1) list.splice(index, 1);
  if (list.length === 0) {
    sockets.delete(k);
    return true;
  }
  return false;
}

export function countSockets(lessonId: string, participantId: string): number {
  return sockets.get(key(lessonId, participantId))?.length ?? 0;
}

/** Для тестов. */
export function resetSocketRegistry(): void {
  sockets.clear();
}
