import { randomBytes, createHash } from "node:crypto";
import type {
  AccessTokenPayload,
  CreateInviteRequest,
  CreateInviteResponse,
  InvitePublicInfo,
  InviteSummary,
} from "@school/shared";
import { env } from "../../plugins/env.js";
import { AppError } from "../../plugins/errors.js";
import * as repo from "./repo.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function assertAdmin(user: AccessTokenPayload): void {
  if (user.role !== "admin") {
    throw new AppError(403, "forbidden", "Приглашения доступны только администратору");
  }
}

/** Хэш кода инвайта — та же схема, что `email_verification_tokens.tokenHash`: сырой код нигде не хранится. */
export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function toSummary(row: {
  id: string;
  role: InviteSummary["role"];
  maxUses: number | null;
  useCount: number;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}): InviteSummary {
  return {
    id: row.id,
    role: row.role,
    maxUses: row.maxUses,
    useCount: row.useCount,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Только admin — создаёт инвайт в СВОЁ пространство (`user.schoolId` из токена). */
export async function createInvite(
  user: AccessTokenPayload,
  input: CreateInviteRequest,
): Promise<CreateInviteResponse> {
  assertAdmin(user);

  const rawCode = randomBytes(24).toString("base64url");
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * MS_PER_DAY) : undefined;

  const row = await repo.insertInvite({
    schoolId: user.schoolId,
    codeHash: hashInviteCode(rawCode),
    role: input.role,
    createdBy: user.sub,
    maxUses: input.maxUses,
    expiresAt,
  });
  const slug = await repo.findSchoolSlug(user.schoolId);

  return {
    id: row.id,
    code: rawCode,
    url: `${env.PUBLIC_ORIGIN}/s/${slug}/invite/${rawCode}`,
    role: row.role,
    maxUses: row.maxUses,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listInvites(user: AccessTokenPayload): Promise<InviteSummary[]> {
  assertAdmin(user);
  const rows = await repo.listInvitesBySchool(user.schoolId);
  return rows.map(toSummary);
}

export async function revokeInvite(user: AccessTokenPayload, id: string): Promise<void> {
  assertAdmin(user);
  const row = await repo.revokeInvite(id, user.schoolId);
  if (!row) {
    throw new AppError(404, "not_found", "Приглашение не найдено");
  }
}

/** Публичный предпросмотр (`GET /invites/:code`), до регистрации — без аутентификации. */
export async function getInvitePublicInfo(code: string): Promise<InvitePublicInfo> {
  const row = await repo.findInviteWithSchoolByCodeHash(hashInviteCode(code));
  if (!row) {
    throw new AppError(404, "not_found", "Приглашение не найдено");
  }

  const now = Date.now();
  const valid =
    !row.revokedAt &&
    (!row.expiresAt || row.expiresAt.getTime() > now) &&
    (row.maxUses == null || row.useCount < row.maxUses);

  return { schoolName: row.schoolName, schoolSlug: row.schoolSlug, role: row.role, valid };
}
