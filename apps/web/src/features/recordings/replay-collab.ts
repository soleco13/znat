import * as Y from "yjs";

/**
 * Эмуляция сервера Hocuspocus внутри страницы кадров экспериментальной
 * записи (`/recording-replay`, docs/experimental-recording.md).
 *
 * Зачем: кадр доски в записи должен быть ТЕМ ЖЕ `Board`, что в живом уроке
 * (страницы, слайды PDF, следование за viewport'ом), а `Board` получает
 * Y.Doc только через `HocuspocusProvider` по WebSocket `/collab`. Вместо
 * правки `Board` подменяем WebSocket для `/collab` на этой странице (и только
 * на ней): «сервер» отдаёт документ из журнала урока на момент t и шлёт
 * Yjs-updates и viewport, когда рендер двигает время вперёд.
 *
 * Протокол — по исходнику `@hocuspocus/provider` 4.6 (MessageType: Sync 0,
 * Awareness 1, Auth 2, QueryAwareness 3, SyncStatus 8; AuthMessageType:
 * Token 0, Authenticated 2) и y-protocols (sync: Step1 0, Step2 1, Update 2).
 * Кодировка — varUint/varString/varUint8Array из lib0, повторена здесь:
 * lib0 не прямая зависимость фронта.
 */

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MSG_AUTH = 2;
const MSG_QUERY_AWARENESS = 3;
const MSG_SYNC_STATUS = 8;
const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;
const AUTH_AUTHENTICATED = 2;

/** Фиксированный clientID «следуемого» в awareness — с реальными не пересекается. */
const FOLLOW_CLIENT_ID = 0x7fff_ff01;

class Writer {
  private bytes: number[] = [];
  varUint(n: number): this {
    let v = n;
    while (v > 0x7f) {
      this.bytes.push(0x80 | (v & 0x7f));
      v = Math.floor(v / 128);
    }
    this.bytes.push(v);
    return this;
  }
  /** Знаковое varInt lib0 (6 бит в первом байте + знак) — только для неотрицательных. */
  varIntPositive(n: number): this {
    let v = n;
    const first = v & 0x3f;
    v = Math.floor(v / 64);
    this.bytes.push(first | (v > 0 ? 0x80 : 0));
    while (v > 0) {
      this.bytes.push((v & 0x7f) | (v > 0x7f ? 0x80 : 0));
      v = Math.floor(v / 128);
    }
    return this;
  }
  varUint8Array(data: Uint8Array): this {
    this.varUint(data.length);
    for (const b of data) this.bytes.push(b);
    return this;
  }
  varString(s: string): this {
    return this.varUint8Array(new TextEncoder().encode(s));
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class Reader {
  private pos = 0;
  constructor(private readonly data: Uint8Array) {}
  varUint(): number {
    let num = 0;
    let mult = 1;
    for (;;) {
      const b = this.data[this.pos++];
      if (b === undefined) throw new Error("unexpected end of message");
      num += (b & 0x7f) * mult;
      if (b < 0x80) return num;
      mult *= 128;
    }
  }
  varUint8Array(): Uint8Array {
    const len = this.varUint();
    const out = this.data.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  varString(): string {
    return new TextDecoder().decode(this.varUint8Array());
  }
}

export interface ViewportState {
  [key: string]: unknown;
}

/** «Сервер» доски для страницы кадров: документ на момент t + awareness следуемого. */
export class ReplayCollabServer {
  readonly doc = new Y.Doc();
  private sockets = new Set<ReplayCollabSocket>();
  private awarenessClock = 0;
  private viewport: ViewportState | null = null;

  constructor(private readonly followUserId: string) {}

  /** Применить Yjs-update журнала и разослать подключённым клиентам. */
  applyUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update);
    for (const socket of this.sockets) {
      socket.deliver(new Writer().varString(socket.documentName).varUint(MSG_SYNC).varUint(SYNC_UPDATE).varUint8Array(update).done());
    }
  }

  setViewport(viewport: ViewportState): void {
    this.viewport = viewport;
    this.awarenessClock += 1;
    for (const socket of this.sockets) socket.deliver(this.awarenessMessage(socket.documentName));
  }

  private awarenessMessage(documentName: string): Uint8Array {
    const state = this.viewport ? { user: { id: this.followUserId, name: "", color: "#000", role: "teacher" }, viewport: this.viewport } : null;
    const update = new Writer()
      .varUint(1)
      .varUint(FOLLOW_CLIENT_ID)
      .varUint(this.awarenessClock)
      .varString(JSON.stringify(state))
      .done();
    return new Writer().varString(documentName).varUint(MSG_AWARENESS).varUint8Array(update).done();
  }

  attach(socket: ReplayCollabSocket): void {
    this.sockets.add(socket);
  }

  detach(socket: ReplayCollabSocket): void {
    this.sockets.delete(socket);
  }

  /** Сообщение клиента → ответы «сервера». */
  handle(socket: ReplayCollabSocket, data: Uint8Array): void {
    const reader = new Reader(data);
    const documentName = reader.varString();
    socket.documentName = documentName;
    const type = reader.varUint();
    const reply = (w: Writer) => socket.deliver(w.done());
    switch (type) {
      case MSG_AUTH:
        // Токен не проверяем: страница уже получила журнал по recorder-токену.
        reply(new Writer().varString(documentName).varUint(MSG_AUTH).varUint(AUTH_AUTHENTICATED).varString("readonly"));
        break;
      case MSG_SYNC: {
        const syncType = reader.varUint();
        if (syncType === SYNC_STEP1) {
          const stateVector = reader.varUint8Array();
          const diff = Y.encodeStateAsUpdate(this.doc, stateVector);
          reply(new Writer().varString(documentName).varUint(MSG_SYNC).varUint(SYNC_STEP2).varUint8Array(diff));
          if (this.viewport) socket.deliver(this.awarenessMessage(documentName));
        } else if (syncType === SYNC_UPDATE || syncType === SYNC_STEP2) {
          // Локальные правки read-only клиента — как живой сервер: «принято», но не применяем.
          reply(new Writer().varString(documentName).varUint(MSG_SYNC_STATUS).varIntPositive(1));
        }
        break;
      }
      case MSG_QUERY_AWARENESS:
        socket.deliver(this.awarenessMessage(documentName));
        break;
      default:
        // Awareness клиента, Close, Pong — серверу записи не нужны.
        break;
    }
  }
}

/** WebSocket-подобный объект, который `HocuspocusProvider` получает вместо настоящего. */
export class ReplayCollabSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = ReplayCollabSocket.CONNECTING;
  binaryType: BinaryType = "arraybuffer";
  documentName = "";
  identifier?: number;

  constructor(
    readonly url: string,
    private readonly server: ReplayCollabServer,
  ) {
    super();
    server.attach(this);
    setTimeout(() => {
      this.readyState = ReplayCollabSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    }, 0);
  }

  send(data: ArrayBufferLike | ArrayBufferView): void {
    if (this.readyState !== ReplayCollabSocket.OPEN) return;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    // Ответ — асинхронно, как из сети: провайдер не ждёт синхронного эха.
    queueMicrotask(() => this.server.handle(this, bytes));
  }

  deliver(message: Uint8Array): void {
    if (this.readyState !== ReplayCollabSocket.OPEN) return;
    const copy = message.slice().buffer;
    this.dispatchEvent(new MessageEvent("message", { data: copy }));
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === ReplayCollabSocket.CLOSED) return;
    this.readyState = ReplayCollabSocket.CLOSED;
    this.server.detach(this);
    this.dispatchEvent(new CloseEvent("close", { code, reason, wasClean: true }));
  }
}

/**
 * Подменить `window.WebSocket` для адресов `/collab` (доска) на эмуляцию;
 * остальные адреса — настоящий WebSocket. Только для страницы кадров.
 */
export function installReplayCollab(server: ReplayCollabServer): void {
  const RealWebSocket = window.WebSocket;
  const Patched = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const href = String(url);
    if (new URL(href, window.location.href).pathname === "/collab") {
      return new ReplayCollabSocket(href, server);
    }
    return new RealWebSocket(url, protocols);
  } as unknown as typeof WebSocket;
  Object.assign(Patched, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = Patched;
}
