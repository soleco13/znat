import type { AccessTokenPayload } from "@school/shared";
import {
  clientMediaSettingsSchema,
  schoolSettingsSchema,
  updateSchoolSettingsRequestSchema,
  type ClientMediaSettings,
  type SchoolSettings,
  type UpdateSchoolSettingsRequest,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as repo from "./repo.js";

/**
 * Э-параметры школы (§10.10 ТЗ, пользовательский запрос 2026-09-14):
 * feature-флаги + мягкие дефолты качества медиа. `schools.settings` —
 * typed jsonb, тот же приём, что `lessons.settings`/`lessonSettingsSchema`
 * (`lessons/service.ts#parseLessonSettings`) — внешняя граница, парсим
 * схемой и не доверяем форме из БД.
 */
function parseSettings(raw: unknown): SchoolSettings {
  const parsed = schoolSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : schoolSettingsSchema.parse({});
}

/**
 * Внутреннее чтение без проверки роли — для других модулей (`guests`,
 * `recordings`, `rooms`), которым нужен один-два флага/дефолта, не вся
 * админ-страница. Экспортируется через `service.ts` (CLAUDE.md: модуль
 * экспортирует только его, чужой `repo.ts` никто не импортирует).
 */
export async function getSchoolSettings(schoolId: string): Promise<SchoolSettings> {
  return parseSettings(await repo.getRawSettings(schoolId));
}

/** Подмножество для клиента урока (`JoinLessonResponse.clientMediaSettings`) — и staff, и гостю. */
export async function getClientMediaSettings(schoolId: string): Promise<ClientMediaSettings> {
  const settings = await getSchoolSettings(schoolId);
  return clientMediaSettingsSchema.parse(settings);
}

function assertAdmin(user: AccessTokenPayload): void {
  if (user.role !== "admin") {
    throw new AppError(403, "forbidden", "Параметры школы доступны только администратору");
  }
}

/** Страница администратора «Параметры» — весь объект целиком, с дефолтами. */
export async function getSettingsForAdmin(user: AccessTokenPayload): Promise<SchoolSettings> {
  assertAdmin(user);
  return getSchoolSettings(user.schoolId);
}

/** `PATCH /admin/settings` — мержит частичный патч поверх текущих значений. */
export async function updateSettings(
  user: AccessTokenPayload,
  patch: UpdateSchoolSettingsRequest,
): Promise<SchoolSettings> {
  assertAdmin(user);
  const current = await getSchoolSettings(user.schoolId);
  const next = schoolSettingsSchema.parse({ ...current, ...updateSchoolSettingsRequestSchema.parse(patch) });
  await repo.updateRawSettings(user.schoolId, next);
  return next;
}
