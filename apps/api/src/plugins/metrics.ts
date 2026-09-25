import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import client from "prom-client";
import {
  getActiveCanvasDocumentsCount,
  getCanvasDocumentsWithPendingUpdatesCount,
  getRejectedReadOnlyUpdatesCount,
} from "../modules/canvas/service.js";
import { getActiveLessonTrafficSnapshot } from "../modules/rooms/service.js";
import { getRecordingLoadSnapshot } from "../modules/recordings/service.js";
import { uploadsInMemoryBytes } from "./uploads.js";

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

new client.Counter({
  name: "canvas_readonly_rejected_updates_total",
  help: "Правки доски, отброшенные сервером из-за read-only подключения",
  registers: [register],
  collect() {
    this.reset();
    this.inc(getRejectedReadOnlyUpdatesCount());
  },
});

new client.Gauge({
  name: "canvas_docs_with_pending_updates",
  help: "Y.Doc в памяти, где правки клиента застряли в pending и не видны другим участникам",
  registers: [register],
  collect() {
    this.set(getCanvasDocumentsWithPendingUpdatesCount());
  },
});

new client.Gauge({
  name: "uploads_in_memory_bytes",
  help: "Байт загрузок, которые процесс сейчас держит в памяти (занятая часть бюджета uploads.ts)",
  registers: [register],
  collect() {
    this.set(uploadsInMemoryBytes());
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
 * Э10.5, §10.4 ТЗ: «алерт „egress без публикующих“ — иначе рекордер жжёт
 * CPU и хранилище впустую». Две метрики, обе вычисляются в момент скрейпа
 * из таблицы `recordings` + presence урока (без параллельного счётчика):
 *
 * - `lesson_recording_active` — сколько записей egress сейчас реально
 *   пишет (`starting`/`recording`). Просто счётчик нагрузки на вторую
 *   машину для дашборда.
 * - `lesson_recording_no_publishers{lesson_id}` — 1, если запись идёт, а в
 *   уроке ноль подключённых участников. Это ПРОКСИ (см.
 *   `rooms/service.ts#countConnectedParticipants`): точное «ноль
 *   публикуемых дорожек» знает только egress (его собственная метрика
 *   `livekit_egress_*` на :9090 второй машины — авторитетный источник,
 *   когда вторая машина поднята и Grafana Agent её скрейпит). Пока
 *   монолит один — этого прокси достаточно, чтобы поймать забытую запись.
 */
new client.Gauge({
  name: "lesson_recording_active",
  help: "Записей уроков, которые egress прямо сейчас пишет (starting/recording)",
  registers: [register],
  async collect() {
    const snapshot = await getRecordingLoadSnapshot();
    this.set(snapshot.length);
  },
});

new client.Gauge({
  name: "lesson_recording_no_publishers",
  help: "1, если запись урока идёт, а подключённых участников в уроке ноль (egress жжёт CPU впустую — прокси, см. metrics.ts)",
  labelNames: ["lesson_id"],
  registers: [register],
  async collect() {
    this.reset();
    const snapshot = await getRecordingLoadSnapshot();
    for (const rec of snapshot) {
      this.set({ lesson_id: rec.lessonId }, rec.connectedParticipants === 0 ? 1 : 0);
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

  app.get("/metrics", async (request, reply) => {
    // Защита в глубину: запрос пришёл через реверс-прокси — значит снаружи,
    // даже если в Caddyfile забыли закрыть путь. Prometheus ходит напрямую.
    if (request.headers["x-forwarded-for"]) {
      return reply.status(404).send({ error: "not_found", message: "Route not found" });
    }
    reply.header("Content-Type", register.contentType);
    return register.metrics();
  });
});
