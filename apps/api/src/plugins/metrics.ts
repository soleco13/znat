import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import client from "prom-client";
import { getActiveCanvasDocumentsCount } from "../modules/canvas/service.js";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Длительность HTTP-запросов",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

/**
 * Э3.3, гейт Э3 плана: «через 10 минут после окончания всех уроков метрика
 * активных Y.Doc = 0» — эта метрика и есть тот сигнал. `collect()` (штатная
 * поддержка prom-client — вычисляемый Gauge без ручного `.set()` на каждое
 * событие) читает текущий размер `hocuspocus.documents` прямо в момент
 * скрейпа, а не поддерживает свой параллельный счётчик — рассинхронизация
 * с реальным состоянием невозможна в принципе.
 */
new client.Gauge({
  name: "canvas_active_ydocs",
  help: "Количество Y.Doc досок урока, прямо сейчас находящихся в памяти процесса",
  registers: [register],
  collect() {
    this.set(getActiveCanvasDocumentsCount());
  },
});

/**
 * /metrics НЕ проксируется публичным Caddyfile — Prometheus скрейпит
 * его напрямую внутри docker-сети (app:3000/metrics), см. docker-compose.monitoring.yml.
 */
export default fp(async function metricsPlugin(app: FastifyInstance) {
  app.addHook("onResponse", async (request, reply) => {
    httpRequestDuration.observe(
      {
        method: request.method,
        route: request.routeOptions.url ?? request.url,
        status_code: reply.statusCode,
      },
      reply.elapsedTime / 1000,
    );
  });

  app.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", register.contentType);
    return register.metrics();
  });
});
