import { existsSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import { env } from "./plugins/env.js";
import errorsPlugin from "./plugins/errors.js";
import authenticatePlugin from "./plugins/authenticate.js";
import rbacPlugin from "./plugins/rbac.js";
import metricsPlugin from "./plugins/metrics.js";
import { initErrorReporting } from "./plugins/sentry.js";
import authRoutes from "./modules/auth/routes.js";
import usersRoutes from "./modules/users/routes.js";
import lessonsRoutes from "./modules/lessons/routes.js";
import { assetsRoutes, filesRoutes } from "./modules/storage/routes.js";
import { pool } from "./db/client.js";

export function buildServer() {
  initErrorReporting();

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
    },
    trustProxy: true,
  });

  app.register(cookie, { secret: env.COOKIE_SECRET });
  app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } });
  app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

  app.register(errorsPlugin);
  app.register(authenticatePlugin);
  app.register(rbacPlugin);
  app.register(metricsPlugin);

  app.get("/health", async () => ({ status: "ok" }));

  app.register(filesRoutes);

  app.register(
    async (api) => {
      api.register(authRoutes);
      api.register(usersRoutes);
      api.register(lessonsRoutes);
      api.register(assetsRoutes);
    },
    { prefix: "/api/v1" },
  );

  const webDistDir = path.resolve(process.cwd(), env.WEB_DIST_DIR);
  if (existsSync(webDistDir)) {
    app.register(staticPlugin, { root: webDistDir, wildcard: false });
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

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down");
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
