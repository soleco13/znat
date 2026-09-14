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
 *   значение, которое клиент подставляет при публикации (`RoomPage.tsx`/
 *   `CameraControls.tsx`/`ScreenShareControls.tsx`), участник может
 *   выбрать своё устройство поверх, но не битрейт/fps — это решает школа.
 * - `recording*` — параметры запуска записи (`egress-client.ts`), тоже
 *   жёсткие, задаёт только школа.
 *
 * Битрейты — везде в Кбит/с (человекопонятная единица, как в большинстве
 * панелей стриминга): клиентский `VideoEncoding.maxBitrate` у LiveKit в
 * бит/с — конвертация `×1000` в `media-quality.ts`; серверный egress
 * `EncodingOptions.videoBitrate`/`audioBitrate` у LiveKit УЖЕ в Кбит/с
 * (дефолты протобафа: video 4500, audio 128 — только в Кбит/с это разумные
 * числа), конвертировать не нужно.
 */

export const mediaQualityPresetSchema = z.enum(["360p", "480p", "720p", "1080p"]);
export type MediaQualityPreset = z.infer<typeof mediaQualityPresetSchema>;

export const framerateSchema = z.union([z.literal(15), z.literal(24), z.literal(30)]);
export type Framerate = z.infer<typeof framerateSchema>;

/** Разумный диапазон битрейта видео (Кбит/с) — ниже 100 картинка не читается, выше 8000 нет смысла для урока/документа. */
const videoBitrateKbpsSchema = z.number().int().min(100).max(8000);

export const schoolSettingsSchema = z.object({
  /** Вход ученика по прямой ссылке без аккаунта (Э12.6, `/j/:token`). */
  guestAccessEnabled: z.boolean().default(true),
  /** Запись урока (поверх инфраструктурного `RECORDING_ENABLED` — если там false, школьный флаг роли не играет). */
  recordingEnabled: z.boolean().default(true),
  /** Демонстрация экрана — кнопка скрыта в UI, если выключено. */
  screenShareEnabled: z.boolean().default(true),
  /** «Картинка в картинке» (Document PiP) — чисто клиентская фича, кнопка скрыта, если выключено. */
  pipEnabled: z.boolean().default(true),

  /** Мягкий дефолт разрешения камеры при публикации (участник может сменить устройство, не качество). */
  cameraResolution: mediaQualityPresetSchema.default("720p"),
  cameraFps: framerateSchema.default(24),
  /** Битрейт видео камеры — по умолчанию как у `VideoPresets.h720` (1700 Кбит/с). */
  cameraBitrateKbps: videoBitrateKbpsSchema.default(1700),
  /** Высокое качество звука (стерео/больший битрейт Opus) — мягкий дефолт микрофона. */
  micHighQuality: z.boolean().default(false),

  /** Мягкий дефолт разрешения/fps/битрейта демонстрации экрана — применяется в `ScreenShareControls.tsx`. */
  screenShareResolution: mediaQualityPresetSchema.default("1080p"),
  screenShareFps: framerateSchema.default(15),
  /** По умолчанию как у `ScreenSharePresets.h1080fps15` (2500 Кбит/с). */
  screenShareBitrateKbps: videoBitrateKbpsSchema.default(2500),

  /** Разрешение/fps/битрейт видеозаписи урока (RoomComposite egress) — см. `egress-client.ts`. */
  recordingResolution: mediaQualityPresetSchema.default("720p"),
  recordingFps: framerateSchema.default(30),
  /**
   * §10.10 ТЗ изначально просил «~1.5 Мбит/с — меньше места на диске», но
   * это бьёт по чёткости: запись — это КОМПОЗИТНЫЙ кадр (демонстрация +
   * лента камер, см. `EgressPage.tsx`), а не одна демонстрация — тому же
   * разрешению там нужно БОЛЬШЕ бит/пиксель, чем чистому потоку демонстрации
   * (`screenShareBitrateKbps`, дефолт 2500 — только под демонстрацию, без
   * камер поверх). При 1500 Кбит/с на 720p текст документа в записи уже
   * заметно бьётся в блочность на глаз (жалоба пользователя 2026-09-14:
   * «на конференции чётко, на записи всё пиксельное») — поднято до 3000.
   */
  recordingBitrateKbps: videoBitrateKbpsSchema.default(3000),
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
 * гостю). Флаги вроде `guestAccessEnabled`/`recordingEnabled` и `recording*`
 * туда не нужны — они проверяются/используются раньше, на входе/старте записи.
 */
export const clientMediaSettingsSchema = schoolSettingsSchema.pick({
  screenShareEnabled: true,
  pipEnabled: true,
  cameraResolution: true,
  cameraFps: true,
  cameraBitrateKbps: true,
  micHighQuality: true,
  screenShareResolution: true,
  screenShareFps: true,
  screenShareBitrateKbps: true,
});
export type ClientMediaSettings = z.infer<typeof clientMediaSettingsSchema>;
