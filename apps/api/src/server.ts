import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import { env } from "./plugins/env.js";
import errorsPlugin from "./plugins/errors.js";
import authenticatePlugin from "./plugins/authenticate.js";
import rbacPlugin from "./plugins/rbac.js";
import lessonAccessPlugin from "./plugins/lesson-access.js";
import recorderAccessPlugin from "./plugins/recorder-access.js";
import metricsPlugin from "./plugins/metrics.js";
import { rateLimitKey, rateLimitMax } from "./plugins/rate-limit-key.js";
import { serializeRequest } from "./plugins/log-redact.js";
import { UPLOAD_LIMITS } from "./plugins/uploads.js";
import { checkHealth } from "./plugins/health.js";
import { initErrorReporting } from "./plugins/sentry.js";
import authRoutes from "./modules/auth/routes.js";
import usersRoutes from "./modules/users/routes.js";
import lessonsRoutes from "./modules/lessons/routes.js";
import guestsRoutes from "./modules/guests/routes.js";
import roomsRoutes from "./modules/rooms/routes.js";
import roomsWsRoutes from "./modules/rooms/ws.js";
import livekitWebhookRoutes from "./modules/rooms/livekit-webhook.js";
import canvasWsRoutes from "./modules/canvas/ws.js";
import canvasRoutes from "./modules/canvas/routes.js";
import decksRoutes from "./modules/decks/routes.js";
import activitiesRoutes from "./modules/activities/routes.js";
import materialsRoutes from "./modules/materials/routes.js";
import recordingsRoutes from "./modules/recordings/routes.js";
import schoolSettingsRoutes from "./modules/school-settings/routes.js";
import registrationRoutes from "./modules/registration/routes.js";
import invitesRoutes from "./modules/invites/routes.js";
import {
  startRecordingRetentionSweep,
  stopRecordingRetentionSweep,
} from "./modules/recordings/service.js";
import {
  buildConvertJobHandlers,
  startDeckReconcileSweep,
  stopDeckReconcileSweep,
} from "./modules/decks/service.js";
import { startConvertEvents, stopConvertEvents } from "./modules/jobs/service.js";
import { startCanvasUnloadSweep, stopCanvasUnloadSweep } from "./modules/canvas/service.js";
import { startPresenceSweep, stopPresenceSweep } from "./modules/rooms/service.js";
import { startRefreshTokenCleanup, stopRefreshTokenCleanup } from "./modules/auth/service.js";
import { startUnverifiedCleanup, stopUnverifiedCleanup } from "./modules/registration/service.js";
import { assetsRoutes, filesRoutes } from "./modules/storage/routes.js";
import { pool } from "./db/client.js";
import { rateLimitRedis, redis } from "./db/redis.js";

const WS_MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

export function buildServer() {
  initErrorReporting();

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      serializers: { req: serializeRequest },
    },
    trustProxy: true,
  });

  app.register(cookie, { secret: env.COOKIE_SECRET });
  // Маршруты передают свой лимит (plugins/uploads.ts); здесь — самый строгий
  // на случай, если новый маршрут его забудет.
  app.register(multipart, {
    limits: { fileSize: UPLOAD_LIMITS.canvasImage, files: 1, fields: 10, parts: 20 },
  });
  // Счётчики в Redis: LRU в памяти процесса держит 5000 ключей, и при большем
  // числе активных людей вытесняет их — лимит перестаёт работать. Redis
  // недоступен → пропускаем запрос, а не роняем урок.
  app.register(rateLimit, {
    max: rateLimitMax,
    keyGenerator: rateLimitKey,
    timeWindow: "1 minute",
    redis: rateLimitRedis,
    nameSpace: "rl:",
    skipOnError: true,
  });
  // Без опций ws принимает сообщения до 100 МБ, и разбираются они до проверки
  // прав. Документ доски целиком — десятки КБ (картинки лежат ссылками), 5 МБ —
  // запас на первую синхронизацию большой доски.
  app.register(websocket, { options: { maxPayload: WS_MAX_PAYLOAD_BYTES } });

  app.register(errorsPlugin);
  app.register(authenticatePlugin);
  app.register(rbacPlugin);
  app.register(lessonAccessPlugin);
  app.register(recorderAccessPlugin);
  app.register(metricsPlugin);

  app.get("/health", async (_request, reply) => {
    const health = await checkHealth({ db: () => pool.query("select 1"), redis: () => redis.ping() });
    return reply
      .status(health.ok ? 200 : 503)
      .send({ status: health.ok ? "ok" : "degraded", db: health.db, redis: health.redis });
  });

  app.register(filesRoutes);
  app.register(roomsWsRoutes);
  app.register(livekitWebhookRoutes);
  app.register(canvasWsRoutes);

  app.register(
    async (api) => {
      api.register(authRoutes);
      api.register(usersRoutes);
      api.register(lessonsRoutes);
      api.register(guestsRoutes);
      api.register(roomsRoutes);
      api.register(canvasRoutes);
      api.register(decksRoutes);
      api.register(activitiesRoutes);
      api.register(materialsRoutes);
      api.register(recordingsRoutes);
      api.register(schoolSettingsRoutes);
      api.register(registrationRoutes);
      api.register(invitesRoutes);
      api.register(assetsRoutes);
    },
    { prefix: "/api/v1" },
  );

  const webDistDir = path.resolve(process.cwd(), env.WEB_DIST_DIR);
  if (existsSync(webDistDir)) {
    app.register(staticPlugin, {
      root: webDistDir,
      wildcard: false,
      // Vite кладёт в assets/ файлы с хешем содержимого в имени — их можно
      // кешировать навсегда, без перепроверки (раньше каждая загрузка
      // страницы давала ~30 запросов с ответом 304). index.html и прочее —
      // всегда перепроверять, иначе новый деплой не доедет до браузера.
      cacheControl: false,
      setHeaders(res, filePath) {
        const immutable = filePath.startsWith(path.join(webDistDir, "assets") + path.sep);
        res.setHeader("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api/") || request.url.startsWith("/files/")) {
        return reply.status(404).send({ error: "not_found", message: "Route not found" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.log.warn({ webDistDir }, "SPA build not found, skipping static file serving");
  }

  return app;
}

async function main() {
  const app = buildServer();
  startPresenceSweep();
  startCanvasUnloadSweep();
  startConvertEvents(buildConvertJobHandlers());
  startDeckReconcileSweep();
  startRecordingRetentionSweep();
  startRefreshTokenCleanup();
  startUnverifiedCleanup();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down");
    stopPresenceSweep();
    stopCanvasUnloadSweep();
    stopDeckReconcileSweep();
    stopRecordingRetentionSweep();
    stopRefreshTokenCleanup();
    stopUnverifiedCleanup();
    await stopConvertEvents();
    await app.close();
    await pool.end();
    redis.disconnect();
    rateLimitRedis.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
