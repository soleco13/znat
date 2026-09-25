import {
  userResponseSchema,
  type CreateUserRequest,
  type UpdateUserRequest,
  type ListUsersQuery,
  type Role,
  type UserResponse,
} from "@school/shared";
import { hashPassword } from "../auth/service.js";
import { AppError } from "../../plugins/errors.js";
import * as repo from "./repo.js";

/**
 * Наружу — только поля ответа: раньше `/users` отдавал строку БД целиком,
 * вместе с хэшем пароля (админ школы мог выгрузить хэши сотрудников).
 */
export function toUserResponse(row: {
  id: string;
  schoolId: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}): UserResponse {
  return userResponseSchema.parse({
    id: row.id,
    schoolId: row.schoolId,
    email: row.email,
    fullName: row.fullName,
    role: row.role,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  });
}

export async function createUser(schoolId: string, input: CreateUserRequest) {
  const passwordHash = await hashPassword(input.password);
  try {
    return await repo.insertUser({
      schoolId,
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      role: input.role,
      // Э14.1: почта self-signup аккаунтов требует подтверждения по ссылке,
      // но админ, создающий сотрудника вручную, тем самым уже ручается за
      // неё — считаем подтверждённой сразу.
      emailVerifiedAt: new Date(),
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, "email_taken", "Пользователь с таким email уже существует");
    }
    throw err;
  }
}

export async function updateUser(schoolId: string, id: string, patch: UpdateUserRequest) {
  const result = await repo.updateUser(id, schoolId, patch);
  if ("lastAdmin" in result) {
    throw new AppError(
      409,
      "last_admin",
      "Это единственный администратор школы — сначала назначьте другого администратора",
    );
  }
  if (!result.row) {
    throw new AppError(404, "not_found", "Пользователь не найден");
  }
  return result.row;
}

export async function listUsers(schoolId: string, query: ListUsersQuery) {
  return repo.listUsers({ schoolId, role: query.role, q: query.q, page: query.page, pageSize: query.pageSize });
}

export async function getUserForAuth(schoolId: string, id: string) {
  return repo.findUserById(id, schoolId);
}

/** Имена по набору id (Э12) — обогащение списков уроков/журнала посещений именем учителя/участника. */
export async function getUserNames(schoolId: string, ids: string[]) {
  const rows = await repo.findUsersByIds(schoolId, [...new Set(ids)]);
  return new Map(rows.map((r) => [r.id, r]));
}

/** Проверяет, что пользователь существует в школе и он учитель (Э12: назначение учителя уроку). */
/**
 * Кто может вести урок: учитель или администратор. Репетитор после
 * самостоятельной регистрации — администратор своего пространства, и без
 * этого не мог создать ни одного урока («Нет активных учителей»).
 */
export async function assertTeacher(schoolId: string, teacherId: string) {
  const user = await repo.findUserById(teacherId, schoolId);
  if (!user || !user.isActive || (user.role !== "teacher" && user.role !== "admin")) {
    throw new AppError(400, "invalid_teacher", "Указанный пользователь не может вести урок");
  }
  return user;
}

export type { Role };

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}
