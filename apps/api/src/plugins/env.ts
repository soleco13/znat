import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
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
});

export const env = envSchema.parse(process.env);
export type Env = typeof env;
