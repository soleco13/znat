import { z } from "zod";

/** Пустая строка в .env (`RAW_RECORDER_SECRET=`) — то же, что переменной нет. */
function emptyToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

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
  /**
   * Места в комнате LiveKit сверх учеников: учитель, админы и методисты,
   * запись урока (egress). Предел комнаты = LESSON_MAX_GUESTS + это.
   */
  LIVEKIT_ROOM_EXTRA_SLOTS: z.coerce.number().int().min(1).max(100).default(10),
  /**
   * Лимиты запросов без личности — по IP: вход по ссылке урока и логин. Класс
   * за одним роутером — один IP; школа побольше или нагрузочный тест (все
   * запросы с одной машины) упирается в них раньше, чем в сам сервер.
   */
  /**
   * G-11: прокси, чьим X-Forwarded-* верить (IP/CIDR через запятую). Не задано —
   * соседи app по docker-сети, кроме шлюза (plugins/trust-proxy.ts).
   */
  TRUSTED_PROXIES: z.string().min(1).optional(),
  /** Уровень логов (по умолчанию info в production, debug в разработке). */
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  /**
   * Файл, куда дублируются логи (помимо stdout). Логи контейнера пропадают при
   * пересоздании — без файла на томе разбирать вчерашний урок нечем.
   */
  LOG_FILE: z.string().min(1).optional(),
  /** Запрос к Postgres дольше этого (мс) логируется как db_query_slow с requestId. */
  DB_SLOW_QUERY_MS: z.coerce.number().int().min(1).default(500),
  RATE_LIMIT_ANONYMOUS_PER_MINUTE: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_GUEST_ENTRY_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  /** Сколько дней хранить сообщения чата урока (152-ФЗ: персональные данные не хранятся бессрочно). */
  CHAT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
  COOKIE_SECRET: z.string().min(32),
  STORAGE_ROOT: z.string().min(1).default("/data/assets"),
  /**
   * Файлы `/files/*` отдаёт Caddy: приложение проверяет подпись и отвечает
   * заголовком `X-Accel-Redirect`, сам файл (слайды, MP4 записей) Node не
   * стримит. Нужен Caddy с тем же томом хранилища (см. Caddyfile).
   */
  FILES_VIA_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  STORAGE_HMAC_SECRET: z.string().min(32),
  /**
   * Загрузки отклоняются, когда на диске хранилища свободно меньше этого.
   * Диск общий с Postgres: забитый загрузками диск остановил бы базу.
   */
  STORAGE_MIN_FREE_GB: z.coerce.number().min(0).default(5),
  /** Сколько одна школа может загрузить за сутки — регистрация открыта, загрузка не должна быть бесконечной. */
  SCHOOL_DAILY_UPLOAD_MB: z.coerce.number().int().min(1).default(2048),
  PUBLIC_ORIGIN: z.string().url().default("http://localhost:3000"),
  WEB_DIST_DIR: z.string().min(1).default("apps/web/dist"),
  /** Постоянный каталог файлов прошлых сборок фронта (web-assets-archive.ts); без него — только текущая сборка. */
  WEB_ASSETS_ARCHIVE_DIR: z.string().min(1).optional(),
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

  // --- Экспериментальная запись (docs/experimental-recording.md). Всё
  //     выключено по умолчанию: без секрета и списка школ любой урок пишется
  //     только основным методом (Egress). ---
  /**
   * Секрет внутреннего API рекордера и рендера (`/internal/raw-recorder/*`,
   * Bearer). Пусто — экспериментальный метод выключен целиком, эндпоинты
   * отвечают 404.
   */
  RAW_RECORDER_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  /**
   * Школы, которым разрешена экспериментальная запись (uuid через запятую).
   * Режим урока (`lesson_recording_modes`) действует только для них —
   * случайная строка в БД не включит новый метод на другой школе. Пусто —
   * никому. Немедленный возврат всех уроков к Egress — очистить переменную.
   */
  RECORDING_EXPERIMENTAL_SCHOOL_IDS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid())),
  /** Адрес LiveKit для рекордера (он в host-сети: обычно ws://127.0.0.1:7880). Пусто — LIVEKIT_URL. */
  RAW_RECORDER_LIVEKIT_URL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /**
   * Origin, с которого Chrome рендера открывает страницу кадров
   * `/recording-replay` (как RECORDING_EGRESS_TEMPLATE_URL — обычно
   * http://127.0.0.1:3000, мимо внешней сети). Пусто — PUBLIC_ORIGIN.
   */
  RAW_RENDER_REPLAY_ORIGIN: z.preprocess(emptyToUndefined, z.string().url().optional()),
  /** Предел длительности одной экспериментальной записи. */
  RAW_RECORDING_MAX_DURATION_SEC: z.coerce.number().int().min(60).max(12 * 3600).default(4 * 3600),
  /**
   * Сколько хранить исходные дорожки после успешной сборки MP4 (часы) — для
   * сравнения и пересборки. До `ready` исходники не удаляются никогда; после
   * `failed` — 14 дней.
   */
  RAW_RECORDING_SOURCE_RETENTION_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(7 * 24),

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
