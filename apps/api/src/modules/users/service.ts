import type { CreateUserRequest, UpdateUserRequest, ListUsersQuery, Role } from "@school/shared";
import { hashPassword } from "../auth/service.js";
import { AppError } from "../../plugins/errors.js";
import * as repo from "./repo.js";
import { parseUsersCsv } from "./csv.js";

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

export async function importUsersFromCsv(schoolId: string, csvContent: string) {
  const rows = parseUsersCsv(csvContent);
  const created: string[] = [];
  const failed: { email: string; reason: string }[] = [];

  for (const row of rows) {
    try {
      await createUser(schoolId, {
        email: row.email,
        fullName: row.fullName,
        role: row.role,
        password: row.password,
      });
      created.push(row.email);
    } catch (err) {
      failed.push({ email: row.email, reason: err instanceof AppError ? err.message : "unknown_error" });
    }
  }

  return { created, failed };
}

export async function createGroup(schoolId: string, input: { name: string; grade: number; academicYear: string }) {
  return repo.insertGroup({ schoolId, ...input });
}

export async function listGroups(schoolId: string) {
  return repo.listGroups(schoolId);
}

export async function addGroupMembers(schoolId: string, groupId: string, userIds: string[]) {
  const group = await repo.findGroupById(groupId, schoolId);
  if (!group) {
    throw new AppError(404, "not_found", "Группа не найдена");
  }
  await repo.addGroupMembers(groupId, userIds);
}

export async function getUserForAuth(schoolId: string, id: string) {
  return repo.findUserById(id, schoolId);
}

export async function getGroupOrThrow(schoolId: string, groupId: string) {
  const group = await repo.findGroupById(groupId, schoolId);
  if (!group) {
    throw new AppError(404, "not_found", "Группа не найдена");
  }
  return group;
}

export type { Role };

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}
