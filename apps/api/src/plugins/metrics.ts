import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import client from "prom-client";
import { getActiveCanvasDocumentsCount } from "../modules/canvas/service.js";
import { getActiveLessonTrafficSnapshot } from "../modules/rooms/service.js";

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
 * Э6.6, §10.8 ТЗ: «трафик по урокам» в Grafana — «видно, кто ест канал».
 * Значение — РАСЧЁТНАЯ оценка (`rooms/service.ts#estimateLessonMbit`, та же
 * арифметика §5.2/§5.2.1 ТЗ, что уже использует ограничитель Э6.5), не
 * прямое измерение сетевого интерфейса — реального измерения на уровне
 * LiveKit/сервера в проекте пока нет. `mode` вторым лейблом — чтобы в
 * Grafana можно было разложить трафик по режимам урока (Э6.4), не только
 * по `lesson_id`. `this.reset()` перед заполнением — лейблы уже
 * завершившихся уроков не должны висеть в реестре со старым значением
 * вечно (`activeLessons` очищает их сам, но набор active-лейблов Prometheus
 * иначе накапливался бы независимо от него).
 */
new client.Gauge({
  name: "lesson_traffic_mbit",
  help: "Расчётная оценка исходящего трафика урока, Мбит/с (не измерение — см. rooms/service.ts#estimateLessonMbit)",
  labelNames: ["lesson_id", "mode"],
  registers: [register],
  async collect() {
    this.reset();
    const snapshot = await getActiveLessonTrafficSnapshot();
    for (const lesson of snapshot) {
      this.set({ lesson_id: lesson.lessonId, mode: lesson.mode }, lesson.estimatedMbit);
    }
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
