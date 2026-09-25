import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  /**
   * Э12.4 — подпись гостевого JWT ученика (`/j/:token/enter`). Отдельный
   * секрет от персонального `JWT_ACCESS_SECRET`: у гостевого токена другой
   * периметр (только один урок, httpOnly-cookie, без refresh) и компрометация
   * одного секрета не должна давать второй класс токенов.
   */
  JWT_GUEST_SECRET: z.string().min(32),
  /** Э12.4 — срок жизни гостевой сессии урока (§1.6 план-ТЗ: «~6 ч, без refresh»). Истекла → перезаход по ссылке. */
  GUEST_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(6),
  /** Потолок учеников в одном уроке (§ ТЗ: класс до 30) — утёкшая ссылка не заведёт в урок сотни гостей. */
  LESSON_MAX_GUESTS: z.coerce.number().int().min(1).max(1000).default(50),
  COOKIE_SECRET: z.string().min(32),
  STORAGE_ROOT: z.string().min(1).default("/data/assets"),
  STORAGE_HMAC_SECRET: z.string().min(32),
  PUBLIC_ORIGIN: z.string().url().default("http://localhost:3000"),
  WEB_DIST_DIR: z.string().min(1).default("apps/web/dist"),
  GLITCHTIP_DSN: z.string().url().optional(),
  LIVEKIT_URL: z.string().url().default("ws://localhost:7880"),
  LIVEKIT_PUBLIC_URL: z.string().url().default("ws://localhost:7880"),
  LIVEKIT_API_KEY: z.string().min(1).default("devkey"),
  LIVEKIT_API_SECRET: z.string().min(1),

  // --- Э10: запись уроков (§10.4 ТЗ). Egress живёт на ВТОРОЙ машине;
  //     API управляет им через тот же LIVEKIT_URL (egress-задания идут
  //     через LiveKit-сервер, не напрямую в egress). ---
  /**
   * Фича-флаг записи. Пока `false` — кнопка «Записать урок» помечена
   * «скоро» (§10.4 ТЗ), эндпоинты старта отвечают 503. Включается только
   * когда вторая машина с egress реально поднята.
   */
  RECORDING_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /**
   * Ретеншн записей в днях (§10.10 ТЗ: «30 дней MVP / 90 целевой»).
   * Джоба автоудаления (Э10.4) чистит `ready`-записи старше этого срока.
   */
  RECORDING_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  /**
   * TTL presigned-ссылки на скачивание записи (§10.10 ТЗ: «TTL 1 час»).
   */
  RECORDING_URL_TTL_SEC: z.coerce.number().int().min(60).max(86400).default(3600),
  /**
   * Базовый URL кастомного layout-шаблона записи (Э10.2), который
   * headless-Chrome внутри egress открывает для композитинга. Пусто →
   * используется дефолтный layout LiveKit. Своё, не с чужого CDN
   * (CLAUDE.md) — обычно `${PUBLIC_ORIGIN}/egress`.
   */
  RECORDING_EGRESS_TEMPLATE_URL: z.string().url().optional(),
  /**
   * Э10.6 — подпись recorder-токена (шаблон записи `/egress`: WS-стейдж,
   * read-only доска, агрегированный вид задания). Отдельный секрет от
   * `JWT_GUEST_SECRET`/`JWT_ACCESS_SECRET` — компрометация одного класса
   * токенов не должна давать другой (тот же принцип, что у гостевого).
   */
  JWT_RECORDER_SECRET: z.string().min(32),

  // --- Э14.1: собственный SMTP-релей на этом же сервере для писем
  //     подтверждения почты при self-signup (гейт §1.2 ТЗ: бесплатный,
  //     не на критическом пути урока — не пришло письмо → просто не
  //     подтверждена почта, урок не деградирует; смена релея — другой хост
  //     в этой же переменной, без переделки архитектуры). ---
  SMTP_HOST: z.string().min(1).default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Адрес отправителя — на проде должен жить в домене с настроенными SPF/DKIM/DMARC (инфра, не код). */
  SMTP_FROM: z.string().min(1).default("no-reply@localhost"),
});

export const env = envSchema.parse(process.env);
export type Env = typeof env;
