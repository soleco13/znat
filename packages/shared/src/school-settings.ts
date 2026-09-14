import { z } from "zod";

/**
 * Пользовательский запрос (2026-09-14): страница администратора
 * «Параметры» — feature-флаги (вкл/выкл функций школы) и мягкие дефолты
 * качества медиа. Хранится в уже существующей `schools.settings` (typed
 * jsonb — тот же приём, что `lessons.settings`/`lessonSettingsSchema`).
 *
 * Строгость применения (согласовано с пользователем):
 * - feature-флаги (`*Enabled`) — жёсткие: сервер реально не даёт выполнить
 *   действие (гостя не пускает, запись не стартует).
 * - качество медиа (`camera*`/`mic*`/`screenShare*`) — МЯГКИЕ дефолты:
 *   значение, которое клиент подставляет при выборе разрешения/fps
 *   (`VideoPresets` в `RoomPage`/`CameraControls`/`ScreenShareControls`),
 *   участник может выбрать своё устройство/качество поверх. Сервер это не
 *   проверяет и не отклоняет — иначе пришлось бы трогать выдачу LiveKit-
 *   токенов и WebRTC-негошиэйшн (CLAUDE.md: «не делегировать вслепую»).
 * - `recordingQuality` — пресет для egress (`egress-client.ts`), тоже
 *   жёсткий (это параметр запуска записи, не участник его выбирает).
 */

export const mediaQualityPresetSchema = z.enum(["360p", "480p", "720p", "1080p"]);
export type MediaQualityPreset = z.infer<typeof mediaQualityPresetSchema>;

export const framerateSchema = z.union([z.literal(15), z.literal(24), z.literal(30)]);
export type Framerate = z.infer<typeof framerateSchema>;

export const recordingQualityPresetSchema = z.enum(["720p30", "1080p30"]);
export type RecordingQualityPreset = z.infer<typeof recordingQualityPresetSchema>;

export const schoolSettingsSchema = z.object({
  /** Вход ученика по прямой ссылке без аккаунта (Э12.6, `/j/:token`). */
  guestAccessEnabled: z.boolean().default(true),
  /** Запись урока (поверх инфраструктурного `RECORDING_ENABLED` — если там false, школьный флаг роли не играет). */
  recordingEnabled: z.boolean().default(true),
  /** Демонстрация экрана — кнопка скрыта в UI, если выключено. */
  screenShareEnabled: z.boolean().default(true),
  /** «Картинка в картинке» (Document PiP) — чисто клиентская фича, кнопка скрыта, если выключено. */
  pipEnabled: z.boolean().default(true),

  /** Мягкий дефолт разрешения камеры при публикации (участник может сменить). */
  cameraResolution: mediaQualityPresetSchema.default("720p"),
  cameraFps: framerateSchema.default(24),
  /** Высокое качество звука (стерео/больший битрейт Opus) — мягкий дефолт микрофона. */
  micHighQuality: z.boolean().default(false),
  /**
   * Мягкий дефолт разрешения/fps демонстрации экрана. ПОКА НЕ ПРИМЕНЯЕТСЯ
   * клиентом (2026-09-14): `ScreenShareControls.tsx` намеренно использует
   * фиксированный `DOCUMENT_SCREEN_SHARE_PRESET` (1080p@5fps, свой битрейт
   * под конкретную пару — §7.1 ТЗ, Э12.7 UX-упрощение «без выбора
   * документ/видео»). Подставлять сюда произвольные resolution/fps без
   * пересчёта битрейта — тот же риск, что уже был с `cpu_cost` egress
   * (см. memory): комбинация может тихо не подтвердиться/деградировать
   * качество. Поля здесь — задел на будущее (хранятся, видны в UI
   * «Параметры»), реальное применение — отдельная задача.
   */
  screenShareResolution: mediaQualityPresetSchema.default("1080p"),
  screenShareFps: framerateSchema.default(15),

  /** Пресет качества записи урока (RoomComposite egress) — см. `egress-client.ts`. */
  recordingQuality: recordingQualityPresetSchema.default("720p30"),
});
export type SchoolSettings = z.infer<typeof schoolSettingsSchema>;

/** Дефолтные настройки школы — единая точка, чтобы бэк и фронт не расходились. */
export const defaultSchoolSettings = (): SchoolSettings => schoolSettingsSchema.parse({});

/** Тело `PATCH /admin/settings` — всё опционально, мержится с текущими значениями. */
export const updateSchoolSettingsRequestSchema = schoolSettingsSchema.partial();
export type UpdateSchoolSettingsRequest = z.infer<typeof updateSchoolSettingsRequestSchema>;

/**
 * Подмножество настроек, нужное клиенту в уроке (мягкие дефолты качества +
 * флаги демонстрации/PiP) — уходит в `JoinLessonResponse` (и staff, и
 * гостю). Флаги вроде `guestAccessEnabled`/`recordingEnabled` туда не
 * нужны — они проверяются раньше, на входе/старте записи.
 */
export const clientMediaSettingsSchema = schoolSettingsSchema.pick({
  screenShareEnabled: true,
  pipEnabled: true,
  cameraResolution: true,
  cameraFps: true,
  micHighQuality: true,
  screenShareResolution: true,
  screenShareFps: true,
});
export type ClientMediaSettings = z.infer<typeof clientMediaSettingsSchema>;
