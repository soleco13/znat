import {
  OutgoingMessage,
  type Connection,
  type Document,
  type afterLoadDocumentPayload,
  type onStatelessPayload,
} from "@hocuspocus/server";
import * as Y from "yjs";

/**
 * Адаптация доски под плохую связь участника — только для ЕГО подключения.
 *
 * `y-excalidraw` на каждое движение пера пишет штрих целиком, так что штрих в
 * 1,8 КБ по сети весит ~150 КБ (154 сообщения). На Wi-Fi это незаметно, а на
 * мобильной сети с потерями TCP копит очередь и отдаёт её пачками — доска
 * «лагает». Для подключения в режиме «слабая связь» вместо каждой правки раз в
 * `POOR_FLUSH_MS` уходит одна разница от последней отправки, собранная из
 * серверного документа: перезаписанные версии штриха в ней уже вычищены GC,
 * поэтому на том же штрихе выходит ~4 раза меньше байт и ~6 раз меньше
 * сообщений. Курсоры (awareness) для него же склеиваются до последнего
 * состояния за окно. Остальные участники получают поток как раньше.
 *
 * Режим включает клиент (`{t:"link",poor}` по stateless — он мерит RTT пингом
 * `{t:"ping"}`) либо сам сервер, когда у сокета копится неотправленное.
 */

export const POOR_FLUSH_MS = 100;
/** Неотправленного в сокете больше — канал до клиента не успевает, включаем режим сами. */
const SERVER_BACKLOG_BYTES = 64 * 1024;
/** Сколько держим режим, включённый сервером по бэклогу (клиент свой снимает сам). */
const SERVER_POOR_HOLD_MS = 20_000;

type PoorState = {
  /** Вектор состояния, который клиент уже гарантированно получил. */
  baseline: Uint8Array;
  timer: ReturnType<typeof setTimeout> | null;
  pendingUpdate: boolean;
  pendingAwareness: Set<number>;
};

type DocState = {
  /** Вектор состояния на момент последней обычной рассылки — всё до него уже у «хороших» клиентов. */
  lastBroadcastSV: Uint8Array;
  poor: Map<Connection, PoorState>;
};

/**
 * Внутренние методы `Document` @hocuspocus/server 4.6 (в типах `private`,
 * проверено чтением dist): вся рассылка правок и курсоров идёт через них.
 * При обновлении пакета сверить — тест `link-adapt.test.ts` упадёт, если их не станет.
 */
type DocumentInternals = {
  broadcast(encode: (address: string) => Uint8Array, filter?: (connection: Connection) => boolean): void;
  broadcastUpdate(update: Uint8Array): void;
  broadcastAwarenessUpdate(changedClients: number[]): void;
};

const docs = new WeakMap<Document, DocState>();
const clientPoor = new WeakSet<Connection>();
const serverPoorUntil = new WeakMap<Connection, number>();
let adaptedFlushes = 0;

export function getAdaptedFlushesCount(): number {
  return adaptedFlushes;
}

function isPoor(connection: Connection, now = Date.now()): boolean {
  return clientPoor.has(connection) || (serverPoorUntil.get(connection) ?? 0) > now;
}

function socketBacklog(connection: Connection): number {
  return (connection.webSocket as { bufferedAmount?: number }).bufferedAmount ?? 0;
}

/** Разница документа с `baseline`, без собственных правок клиента — их он и так знает. */
function diffFor(document: Document, connection: Connection, baseline: Uint8Array): Uint8Array {
  const sv = Y.decodeStateVector(baseline);
  for (const clientId of document.getClients(connection)) {
    sv.set(clientId, Y.getState(document.store, clientId));
  }
  return Y.encodeStateAsUpdate(document, Y.encodeStateVector(sv));
}

function flushPoor(document: Document, connection: Connection, state: PoorState): void {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  if (state.pendingUpdate) {
    state.pendingUpdate = false;
    const update = diffFor(document, connection, state.baseline);
    state.baseline = Y.encodeStateVector(document);
    connection.send(new OutgoingMessage(connection.messageAddress).createSyncMessage().writeUpdate(update).toUint8Array());
    adaptedFlushes++;
  }
  if (state.pendingAwareness.size > 0) {
    const clients = [...state.pendingAwareness];
    state.pendingAwareness.clear();
    connection.send(
      new OutgoingMessage(connection.messageAddress)
        .createAwarenessUpdateMessage(document.awareness, clients)
        .toUint8Array(),
    );
  }
}

function schedule(document: Document, connection: Connection, state: PoorState): void {
  if (state.timer) return;
  state.timer = setTimeout(() => flushPoor(document, connection, state), POOR_FLUSH_MS);
}

/** Приводит набор «плохих» подключений документа к текущим флагам. */
function reconcile(document: Document, doc: DocState, now = Date.now()): void {
  for (const connection of document.getConnections()) {
    const poorNow = isPoor(connection, now);
    const state = doc.poor.get(connection);
    if (poorNow && !state) {
      doc.poor.set(connection, {
        baseline: doc.lastBroadcastSV,
        timer: null,
        pendingUpdate: false,
        pendingAwareness: new Set(),
      });
    } else if (!poorNow && state) {
      flushPoor(document, connection, state);
      doc.poor.delete(connection);
    }
  }
  for (const [connection, state] of doc.poor) {
    if (!document.hasConnection(connection)) {
      if (state.timer) clearTimeout(state.timer);
      doc.poor.delete(connection);
    }
  }
}

/**
 * Хук `afterLoadDocument`: подменяет рассылку правок и курсоров документа —
 * «хорошим» подключениям как раньше, «плохим» — склеенно по таймеру.
 */
export async function adaptBroadcastsToLink(payload: Pick<afterLoadDocumentPayload, "document">): Promise<void> {
  const document = payload.document;
  if (docs.has(document)) return;
  const internals = document as unknown as DocumentInternals;
  if (typeof internals.broadcast !== "function" || typeof internals.broadcastUpdate !== "function") {
    console.warn("canvas: внутренности Hocuspocus изменились — адаптация доски под слабую связь выключена");
    return;
  }
  const doc: DocState = { lastBroadcastSV: Y.encodeStateVector(document), poor: new Map() };
  docs.set(document, doc);

  internals.broadcastUpdate = (update: Uint8Array) => {
    const now = Date.now();
    for (const connection of document.getConnections()) {
      if (!doc.poor.has(connection) && socketBacklog(connection) > SERVER_BACKLOG_BYTES) {
        serverPoorUntil.set(connection, now + SERVER_POOR_HOLD_MS);
      }
    }
    reconcile(document, doc, now);
    internals.broadcast(
      (address) => new OutgoingMessage(address).createSyncMessage().writeUpdate(update).toUint8Array(),
      (connection) => !doc.poor.has(connection),
    );
    doc.lastBroadcastSV = Y.encodeStateVector(document);
    for (const [connection, state] of doc.poor) {
      state.pendingUpdate = true;
      schedule(document, connection, state);
    }
  };

  internals.broadcastAwarenessUpdate = (changedClients: number[]) => {
    reconcile(document, doc);
    internals.broadcast(
      (address) =>
        new OutgoingMessage(address).createAwarenessUpdateMessage(document.awareness, changedClients).toUint8Array(),
      (connection) => !doc.poor.has(connection),
    );
    for (const [connection, state] of doc.poor) {
      for (const clientId of changedClients) state.pendingAwareness.add(clientId);
      schedule(document, connection, state);
    }
  };
}

type LinkMessage = { t: "ping"; i: number } | { t: "link"; poor: boolean };

function parseLinkMessage(raw: string): LinkMessage | null {
  if (raw.length > 200) return null;
  try {
    const msg = JSON.parse(raw) as Partial<{ t: unknown; i: unknown; poor: unknown }>;
    if (msg.t === "ping" && typeof msg.i === "number") return { t: "ping", i: msg.i };
    if (msg.t === "link" && typeof msg.poor === "boolean") return { t: "link", poor: msg.poor };
  } catch {
    // не наш формат — игнорируем
  }
  return null;
}

/** Хук `onStateless`: пинг клиента (замер RTT) и его отчёт о качестве связи. */
export async function handleLinkStateless(
  payload: Pick<onStatelessPayload, "connection" | "document" | "payload">,
): Promise<void> {
  const msg = parseLinkMessage(payload.payload);
  if (!msg) return;
  if (msg.t === "ping") {
    payload.connection.sendStateless(JSON.stringify({ t: "pong", i: msg.i }));
    return;
  }
  if (msg.poor !== clientPoor.has(payload.connection)) {
    const userId = (payload.connection.context as { userId?: string } | undefined)?.userId ?? "unknown";
    console.info(`canvas: слабая связь ${msg.poor ? "вкл" : "выкл"} lesson=${payload.document.name} participant=${userId}`);
  }
  if (msg.poor) clientPoor.add(payload.connection);
  else {
    clientPoor.delete(payload.connection);
    serverPoorUntil.delete(payload.connection);
  }
  const doc = docs.get(payload.document);
  if (doc) reconcile(payload.document, doc);
}
