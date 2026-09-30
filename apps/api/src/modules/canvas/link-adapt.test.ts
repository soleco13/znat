import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Document, type Connection } from "@hocuspocus/server";
import * as Y from "yjs";
import { POOR_FLUSH_MS, adaptBroadcastsToLink, handleLinkStateless } from "./link-adapt.js";

/** Минимальный разбор varint-протокола Hocuspocus: адрес, тип, для Sync — подтип и тело. */
function parseMessage(bytes: Uint8Array): { type: number; sub?: number; body?: Uint8Array } {
  let pos = 0;
  const readUint = () => {
    let num = 0;
    let mult = 1;
    for (;;) {
      const b = bytes[pos++]!;
      num += (b & 0x7f) * mult;
      if (b < 0x80) return num;
      mult *= 128;
    }
  };
  const addressLen = readUint();
  pos += addressLen;
  const type = readUint();
  if (type !== 0) return { type };
  const sub = readUint();
  const len = readUint();
  return { type, sub, body: bytes.slice(pos, pos + len) };
}

type FakeConnection = Connection & { sent: Uint8Array[]; stateless: string[] };

function fakeConnection(): FakeConnection {
  const conn = {
    sent: [] as Uint8Array[],
    stateless: [] as string[],
    messageAddress: "doc",
    webSocket: { bufferedAmount: 0 },
    send(message: Uint8Array) {
      conn.sent.push(message);
    },
    sendStateless(payload: string) {
      conn.stateless.push(payload);
    },
  };
  return conn as unknown as FakeConnection;
}

function yjsUpdates(conn: FakeConnection): Uint8Array[] {
  return conn.sent.map(parseMessage).filter((m) => m.type === 0 && m.sub === 2).map((m) => m.body!);
}

/** Штрих, как его пишет y-excalidraw: на каждое движение — элемент целиком. */
function drawStroke(author: Y.Doc, steps: number, onStep?: () => void): void {
  const arr = author.getArray<Y.Map<unknown>>("elements:p1");
  const entry = new Y.Map<unknown>();
  author.transact(() => arr.push([entry]));
  onStep?.();
  for (let k = 2; k <= steps; k++) {
    const points = Array.from({ length: k }, (_, i) => [i * 2, i % 7]);
    author.transact(() => entry.set("el", { id: "s1", type: "freedraw", version: k, points }));
    onStep?.();
  }
}

describe("адаптация доски под слабую связь", () => {
  let document: Document;
  let good: FakeConnection;
  let poor: FakeConnection;

  beforeEach(async () => {
    vi.useFakeTimers();
    document = new Document("doc", { gc: true }, { flushDelay: false });
    good = fakeConnection();
    poor = fakeConnection();
    document.addConnection(good);
    document.addConnection(poor);
    await adaptBroadcastsToLink({ document });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("пинг получает понг с тем же номером", async () => {
    await handleLinkStateless({ connection: poor, document, payload: JSON.stringify({ t: "ping", i: 7 }) });
    expect(poor.stateless).toEqual([JSON.stringify({ t: "pong", i: 7 })]);
  });

  it("по умолчанию все получают каждую правку сразу", () => {
    const author = new Y.Doc();
    author.on("update", (u: Uint8Array) => Y.applyUpdate(document, u));
    drawStroke(author, 20);
    expect(yjsUpdates(good)).toHaveLength(20);
    expect(yjsUpdates(poor)).toHaveLength(20);
  });

  it("слабая связь: склеенный поток меньше, реплика сходится, хорошему — без изменений", async () => {
    await handleLinkStateless({ connection: poor, document, payload: JSON.stringify({ t: "link", poor: true }) });
    const author = new Y.Doc();
    author.on("update", (u: Uint8Array) => Y.applyUpdate(document, u));
    // ~60 движений в секунду
    drawStroke(author, 120, () => vi.advanceTimersByTime(16));
    vi.advanceTimersByTime(POOR_FLUSH_MS);

    const goodUpdates = yjsUpdates(good);
    const poorUpdates = yjsUpdates(poor);
    expect(goodUpdates).toHaveLength(120);
    expect(poorUpdates.length).toBeLessThan(30);
    const bytes = (list: Uint8Array[]) => list.reduce((n, u) => n + u.length, 0);
    expect(bytes(poorUpdates)).toBeLessThan(bytes(goodUpdates) / 3);

    const replica = new Y.Doc();
    for (const u of poorUpdates) Y.applyUpdate(replica, u);
    expect(replica.getArray("elements:p1").toJSON()).toEqual(document.getArray("elements:p1").toJSON());
  });

  it("свои правки слабому клиенту обратно не шлются", async () => {
    const author = new Y.Doc();
    (document.getClients(poor) as Set<number>).add(author.clientID);
    await handleLinkStateless({ connection: poor, document, payload: JSON.stringify({ t: "link", poor: true }) });
    author.on("update", (u: Uint8Array) => Y.applyUpdate(document, u));
    drawStroke(author, 30, () => vi.advanceTimersByTime(16));
    vi.advanceTimersByTime(POOR_FLUSH_MS);
    const total = yjsUpdates(poor).reduce((n, u) => n + u.length, 0);
    // Только служебное (набор удалений), без содержимого штриха.
    expect(total).toBeLessThan(yjsUpdates(poor).length * 64);
  });

  it("возврат к нормальной связи сразу досылает накопленное и дальше идёт обычный поток", async () => {
    await handleLinkStateless({ connection: poor, document, payload: JSON.stringify({ t: "link", poor: true }) });
    const author = new Y.Doc();
    author.on("update", (u: Uint8Array) => Y.applyUpdate(document, u));
    drawStroke(author, 5);
    expect(yjsUpdates(poor)).toHaveLength(0);
    await handleLinkStateless({ connection: poor, document, payload: JSON.stringify({ t: "link", poor: false }) });
    expect(yjsUpdates(poor)).toHaveLength(1);
    author.getArray("elements:p1").delete(0, 1);
    expect(yjsUpdates(poor)).toHaveLength(2);

    const replica = new Y.Doc();
    for (const u of yjsUpdates(poor)) Y.applyUpdate(replica, u);
    expect(replica.getArray("elements:p1").length).toBe(0);
  });

  it("бэклог сокета включает режим без отчёта клиента", () => {
    (poor.webSocket as unknown as { bufferedAmount: number }).bufferedAmount = 1024 * 1024;
    const author = new Y.Doc();
    author.on("update", (u: Uint8Array) => Y.applyUpdate(document, u));
    drawStroke(author, 10);
    expect(yjsUpdates(poor)).toHaveLength(0);
    vi.advanceTimersByTime(POOR_FLUSH_MS);
    expect(yjsUpdates(poor)).toHaveLength(1);
  });

  it("курсоры слабому клиенту склеиваются до последнего состояния", async () => {
    await handleLinkStateless({ connection: poor, document, payload: JSON.stringify({ t: "link", poor: true }) });
    const awareness = document.awareness;
    for (let i = 0; i < 30; i++) awareness.setLocalState({ pointer: { x: i, y: i } });
    const awarenessCount = (c: FakeConnection) => c.sent.map(parseMessage).filter((m) => m.type === 1).length;
    expect(awarenessCount(good)).toBeGreaterThanOrEqual(30);
    expect(awarenessCount(poor)).toBe(0);
    vi.advanceTimersByTime(POOR_FLUSH_MS);
    expect(awarenessCount(poor)).toBe(1);
  });
});
