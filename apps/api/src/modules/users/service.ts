import type { CreateUserRequest, UpdateUserRequest, ListUsersQuery, Role } from "@school/shared";
import { hashPassword } from "../auth/service.js";
import { AppError } from "../../plugins/errors.js";
import * as repo from "./repo.js";

export async function createUser(schoolId: string, input: CreateUserRequest) {
  const passwordHash = await hashPassword(input.password);
  try {
    return await repo.insertUser({
      schoolId,
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      role: input.role,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, "email_taken", "Пользователь с таким email уже существует");
    }
    throw err;
  }
}

export async function updateUser(schoolId: string, id: string, patch: UpdateUserRequest) {
  const row = await repo.updateUser(id, schoolId, patch);
  if (!row) {
    throw new AppError(404, "not_found", "Пользователь не найден");
  }
  return row;
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
export async function assertTeacher(schoolId: string, teacherId: string) {
  const user = await repo.findUserById(teacherId, schoolId);
  if (!user || user.role !== "teacher") {
    throw new AppError(400, "invalid_teacher", "Указанный пользователь не является учителем");
  }
  return user;
}

export type { Role };

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}
