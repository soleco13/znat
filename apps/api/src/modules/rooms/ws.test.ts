import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";

const { roomsServiceMock } = vi.hoisted(() => ({
  roomsServiceMock: {
    attachSocket: vi.fn(),
    markDisconnected: vi.fn().mockResolvedValue(undefined),
    touchHeartbeat: vi.fn().mockResolvedValue(true),
    listParticipantsSnapshot: vi.fn().mockResolvedValue([]),
    getLessonStateSnapshot: vi.fn().mockResolvedValue({ stage: { kind: "grid" }, mode: "free", entryLocked: false }),
    getCurrentLessonStage: vi.fn(),
    assertGuestNotLockedOut: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./service.js", () => roomsServiceMock);
vi.mock("../auth/service.js", () => ({
  verifyAccessToken: vi.fn(async (token: string) => ({ sub: token })),
}));
vi.mock("../guests/service.js", () => ({
  GUEST_COOKIE_NAME: "guest_session",
  resolveGuestSession: vi.fn(),
}));
vi.mock("../recorder-auth/service.js", () => ({ verifyRecorderToken: vi.fn() }));
vi.mock("../recordings/service.js", () => ({ isLessonRecordingActive: vi.fn().mockResolvedValue(false) }));

import roomsWsRoutes from "./ws.js";
import { MAX_SOCKETS_PER_PARTICIPANT, SUPERSEDED_CLOSE_CODE, countSockets, resetSocketRegistry } from "./socket-registry.js";

type WebSocket = Awaited<ReturnType<FastifyInstance["injectWS"]>>;

const LESSON = "11111111-1111-4111-8111-111111111111";

function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    if (ws.readyState === ws.CLOSED) resolve(-1);
    ws.on("close", (code: number) => resolve(code));
  });
}

/** Подключение считается установленным, когда пришёл снимок присутствия (или его уже закрыли). */
async function open(app: FastifyInstance, participant: string): Promise<WebSocket> {
  let firstMessage!: Promise<void>;
  const ws = await app.injectWS(`/ws?lessonId=${LESSON}&token=${participant}`, {}, {
    onInit: (socket: WebSocket) => {
      // Или закрытие: при одновременных подключениях сокет могут вытеснить до снимка.
      firstMessage = new Promise<void>((resolve) => {
        socket.once("message", () => resolve());
        socket.once("close", () => resolve());
      });
    },
  });
  await firstMessage;
  return ws;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

describe("G-04: WS-каналов урока на участника", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetSocketRegistry();
    roomsServiceMock.attachSocket.mockImplementation(async (_lesson: string, userId: string) => ({ userId }));
    app = Fastify();
    await app.register(cookie);
    await app.register(websocket);
    await app.register(roomsWsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("сотня подключений одной личности оставляет открытыми не больше предела", async () => {
    const sockets: WebSocket[] = [];
    const codes: Promise<number>[] = [];
    for (let i = 0; i < 100; i += 1) {
      const ws = await open(app, "guest-a");
      sockets.push(ws);
      codes.push(closed(ws));
    }
    await flush();

    expect(countSockets(LESSON, "guest-a")).toBe(MAX_SOCKETS_PER_PARTICIPANT);
    const open_ = sockets.filter((ws) => ws.readyState === ws.OPEN);
    expect(open_).toHaveLength(MAX_SOCKETS_PER_PARTICIPANT);
    // Открытыми остаются самые новые, старые закрыты кодом «вытеснен».
    expect(open_).toEqual(sockets.slice(-MAX_SOCKETS_PER_PARTICIPANT));
    const evictedCodes = await Promise.all(codes.slice(0, 100 - MAX_SOCKETS_PER_PARTICIPANT));
    expect(new Set(evictedCodes)).toEqual(new Set([SUPERSEDED_CLOSE_CODE]));
    // Вытеснение не отмечает участника отключённым — он на связи по новому сокету.
    expect(roomsServiceMock.markDisconnected).not.toHaveBeenCalled();
  });

  it("одновременные подключения тоже не проходят мимо предела", async () => {
    const sockets = await Promise.all(Array.from({ length: 30 }, () => open(app, "guest-b")));
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sockets.filter((ws: WebSocket) => ws.readyState === ws.OPEN)).toHaveLength(MAX_SOCKETS_PER_PARTICIPANT);
    expect(countSockets(LESSON, "guest-b")).toBe(MAX_SOCKETS_PER_PARTICIPANT);
  });

  it("переподключение: мёртвый старый сокет, закрывшийся позже, не гасит «на связи»", async () => {
    const old = await open(app, "guest-c");
    const fresh = await open(app, "guest-c");
    old.terminate();
    await closed(old);
    await flush();
    expect(roomsServiceMock.markDisconnected).not.toHaveBeenCalled();
    expect(fresh.readyState).toBe(fresh.OPEN);

    // Закрылся последний — участник отключён, как и раньше (вкладка закрыта).
    fresh.terminate();
    await closed(fresh);
    await vi.waitFor(() => expect(roomsServiceMock.markDisconnected).toHaveBeenCalledTimes(1));
    expect(roomsServiceMock.markDisconnected).toHaveBeenCalledWith(LESSON, "guest-c");
    expect(countSockets(LESSON, "guest-c")).toBe(0);
  });

  it("F5: одно соединение закрылось, новое открылось — участник снова на связи", async () => {
    const first = await open(app, "guest-d");
    // injectWS не доводит чистое закрытие до серверного 'close' — обрыв, как у вкладки на F5.
    first.terminate();
    await closed(first);
    await vi.waitFor(() => expect(roomsServiceMock.markDisconnected).toHaveBeenCalledTimes(1));
    const second = await open(app, "guest-d");
    expect(second.readyState).toBe(second.OPEN);
    expect(roomsServiceMock.attachSocket).toHaveBeenCalledTimes(2);
    expect(countSockets(LESSON, "guest-d")).toBe(1);
  });

  it("предел — на личность: разные участники друг друга не вытесняют", async () => {
    const sockets: WebSocket[] = [];
    for (const who of ["t", "s1", "s2", "s3", "s4"]) sockets.push(await open(app, who));
    await flush();
    expect(sockets.every((ws) => ws.readyState === ws.OPEN)).toBe(true);
  });

  it("не вошедший в урок участник сокет не получает и в реестр не попадает", async () => {
    roomsServiceMock.attachSocket.mockResolvedValueOnce(null);
    const ws = await app.injectWS(`/ws?lessonId=${LESSON}&token=stranger`);
    expect(await closed(ws)).toBe(4003);
    expect(countSockets(LESSON, "stranger")).toBe(0);
  });
});
