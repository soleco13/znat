import { createHash } from "node:crypto";
import Fastify from "fastify";
import { AccessToken } from "livekit-server-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

const roomsServiceMock = vi.hoisted(() => ({
  handleParticipantLeftWebhook: vi.fn(),
  handleRoomFinishedWebhook: vi.fn(),
  handleScreenShareStartedWebhook: vi.fn(),
  handleScreenShareStoppedWebhook: vi.fn(),
}));
vi.mock("./service.js", () => roomsServiceMock);

const livekitWebhookRoutes = (await import("./livekit-webhook.js")).default;

const API_KEY = "devkey";
const API_SECRET = "test-livekit-api-secret";

function sha256Base64(body: string): string {
  return createHash("sha256").update(body).digest("base64");
}

/** Строит валидную подпись вебхука так же, как это делает сам LiveKit-сервер — см. WebhookReceiver.test.ts из SDK. */
async function signedAuthHeader(body: string, secret = API_SECRET): Promise<string> {
  const t = new AccessToken(API_KEY, secret);
  t.sha256 = sha256Base64(body);
  return t.toJwt();
}

async function buildApp() {
  const app = Fastify();
  await app.register(livekitWebhookRoutes);
  return app;
}

async function post(app: Awaited<ReturnType<typeof buildApp>>, body: string, authorization?: string) {
  return app.inject({
    method: "POST",
    url: "/webhooks/livekit",
    headers: { "content-type": "application/webhook+json", ...(authorization ? { authorization } : {}) },
    payload: body,
  });
}

describe("POST /webhooks/livekit (Э2.7)", () => {
  afterEach(() => vi.clearAllMocks());

  it("валидный participant_left вызывает roomsService.handleParticipantLeftWebhook", async () => {
    const app = await buildApp();
    const body = JSON.stringify({
      event: "participant_left",
      room: { name: "lesson-abc" },
      participant: { identity: "11111111-1111-1111-1111-111111111111" },
    });

    const res = await post(app, body, await signedAuthHeader(body));

    expect(res.statusCode).toBe(200);
    expect(roomsServiceMock.handleParticipantLeftWebhook).toHaveBeenCalledWith(
      "lesson-abc",
      "11111111-1111-1111-1111-111111111111",
    );
    await app.close();
  });

  it("валидный room_finished вызывает roomsService.handleRoomFinishedWebhook", async () => {
    const app = await buildApp();
    const body = JSON.stringify({ event: "room_finished", room: { name: "lesson-abc" } });

    const res = await post(app, body, await signedAuthHeader(body));

    expect(res.statusCode).toBe(200);
    expect(roomsServiceMock.handleRoomFinishedWebhook).toHaveBeenCalledWith("lesson-abc");
    await app.close();
  });

  it("отклоняет запрос без подписи — 401, обработчики не вызываются", async () => {
    const app = await buildApp();
    const body = JSON.stringify({ event: "room_finished", room: { name: "lesson-abc" } });

    const res = await post(app, body);

    expect(res.statusCode).toBe(401);
    expect(roomsServiceMock.handleRoomFinishedWebhook).not.toHaveBeenCalled();
    await app.close();
  });

  it("отклоняет запрос, подписанный чужим секретом", async () => {
    const app = await buildApp();
    const body = JSON.stringify({ event: "room_finished", room: { name: "lesson-abc" } });

    const res = await post(app, body, await signedAuthHeader(body, "чужой-секрет-не-менее-32-символов"));

    expect(res.statusCode).toBe(401);
    expect(roomsServiceMock.handleRoomFinishedWebhook).not.toHaveBeenCalled();
    await app.close();
  });

  it("отклоняет запрос, где тело подменено после подписи (sha256 не совпадает)", async () => {
    const app = await buildApp();
    const signedBody = JSON.stringify({ event: "room_finished", room: { name: "lesson-abc" } });
    const authorization = await signedAuthHeader(signedBody);
    const tamperedBody = JSON.stringify({ event: "room_finished", room: { name: "lesson-XXX" } });

    const res = await post(app, tamperedBody, authorization);

    expect(res.statusCode).toBe(401);
    expect(roomsServiceMock.handleRoomFinishedWebhook).not.toHaveBeenCalled();
    await app.close();
  });

  it("track_published SCREEN_SHARE вызывает handleScreenShareStartedWebhook (Э7.2/Э7.3)", async () => {
    const app = await buildApp();
    const body = JSON.stringify({
      event: "track_published",
      room: { name: "lesson-abc" },
      participant: { identity: "11111111-1111-1111-1111-111111111111" },
      track: { source: "SCREEN_SHARE" },
    });

    const res = await post(app, body, await signedAuthHeader(body));

    expect(res.statusCode).toBe(200);
    expect(roomsServiceMock.handleScreenShareStartedWebhook).toHaveBeenCalledWith(
      "lesson-abc",
      "11111111-1111-1111-1111-111111111111",
    );
    await app.close();
  });

  it("track_published камеры НЕ вызывает обработчик демонстрации экрана", async () => {
    const app = await buildApp();
    const body = JSON.stringify({
      event: "track_published",
      room: { name: "lesson-abc" },
      participant: { identity: "11111111-1111-1111-1111-111111111111" },
      track: { source: "CAMERA" },
    });

    const res = await post(app, body, await signedAuthHeader(body));

    expect(res.statusCode).toBe(200);
    expect(roomsServiceMock.handleScreenShareStartedWebhook).not.toHaveBeenCalled();
    await app.close();
  });

  it("track_unpublished SCREEN_SHARE вызывает handleScreenShareStoppedWebhook", async () => {
    const app = await buildApp();
    const body = JSON.stringify({
      event: "track_unpublished",
      room: { name: "lesson-abc" },
      participant: { identity: "11111111-1111-1111-1111-111111111111" },
      track: { source: "SCREEN_SHARE" },
    });

    const res = await post(app, body, await signedAuthHeader(body));

    expect(res.statusCode).toBe(200);
    expect(roomsServiceMock.handleScreenShareStoppedWebhook).toHaveBeenCalledWith(
      "lesson-abc",
      "11111111-1111-1111-1111-111111111111",
    );
    await app.close();
  });

  it("игнорирует события без обработчика (например room_started) — 200, без побочных эффектов", async () => {
    const app = await buildApp();
    const body = JSON.stringify({ event: "room_started", room: { name: "lesson-abc" } });

    const res = await post(app, body, await signedAuthHeader(body));

    expect(res.statusCode).toBe(200);
    expect(roomsServiceMock.handleParticipantLeftWebhook).not.toHaveBeenCalled();
    expect(roomsServiceMock.handleRoomFinishedWebhook).not.toHaveBeenCalled();
    await app.close();
  });
});
