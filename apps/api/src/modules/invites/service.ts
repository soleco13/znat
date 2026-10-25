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
import { logTaskFailure } from "../../plugins/logger.js";
import * as billingService from "../billing/service.js";
import * as mailService from "../mail/service.js";
import * as membershipsService from "../memberships/service.js";
import * as usersService from "../users/service.js";
import * as repo from "./repo.js";

/** Приглашение на почту действует 14 дней, если админ не задал другой срок. */
const EMAIL_INVITE_DAYS = 14;
const ROLE_GENITIVE: Record<string, string> = { admin: "администратора", methodist: "методиста", teacher: "учителя" };

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
  email?: string | null;
  sentAt?: Date | null;
}): InviteSummary {
  return {
    id: row.id,
    role: row.role,
    maxUses: row.maxUses,
    useCount: row.useCount,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    email: row.email ?? null,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
  };
}

const inviteUrl = (slug: string | null, code: string) => `${env.PUBLIC_ORIGIN}/s/${slug}/invite/${code}`;

/** Письмо с приглашением; сбой SMTP не отменяет приглашение — его можно отправить ещё раз. */
async function emailInvite(user: AccessTokenPayload, invite: { id: string; role: string; email: string; expiresAt: Date | null }, code: string): Promise<boolean> {
  try {
    const [schoolName, slug, names] = await Promise.all([
      repo.findSchoolName(user.schoolId),
      repo.findSchoolSlug(user.schoolId),
      usersService.getUserNames(user.schoolId, [user.sub]),
    ]);
    await mailService.sendInviteEmail(invite.email, {
      schoolName: schoolName ?? "Матис",
      roleLabel: ROLE_GENITIVE[invite.role] ?? invite.role,
      inviterName: names.get(user.sub)?.fullName ?? null,
      url: inviteUrl(slug, code),
      expiresAt: invite.expiresAt,
    });
    await repo.markSent(invite.id);
    return true;
  } catch (err) {
    logTaskFailure("mail.invite", err, { integration: "smtp", inviteId: invite.id });
    return false;
  }
}

/** Только admin — создаёт инвайт в СВОЁ пространство (`user.schoolId` из токена). */
export async function createInvite(
  user: AccessTokenPayload,
  input: CreateInviteRequest,
): Promise<CreateInviteResponse> {
  assertAdmin(user);
  // Э15.6: учителей и методистов — не больше, чем даёт тариф (проверяется и при принятии).
  await billingService.assertRoleSeat(user.schoolId, input.role);

  const rawCode = randomBytes(24).toString("base64url");
  const days = input.expiresInDays ?? (input.email ? EMAIL_INVITE_DAYS : undefined);
  const expiresAt = days ? new Date(Date.now() + days * MS_PER_DAY) : undefined;

  const row = await repo.insertInvite({
    schoolId: user.schoolId,
    codeHash: hashInviteCode(rawCode),
    role: input.role,
    createdBy: user.sub,
    // Приглашение на почту — одноразовое.
    maxUses: input.email ? 1 : input.maxUses,
    expiresAt,
    email: input.email,
  });
  const slug = await repo.findSchoolSlug(user.schoolId);
  const emailed = input.email
    ? await emailInvite(user, { id: row.id, role: row.role, email: input.email, expiresAt: row.expiresAt }, rawCode)
    : false;

  return {
    id: row.id,
    code: rawCode,
    url: inviteUrl(slug, rawCode),
    role: row.role,
    maxUses: row.maxUses,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    emailed,
  };
}

/** Повторная отправка приглашения на почту: новая ссылка, прежняя перестаёт работать. */
export async function resendInvite(user: AccessTokenPayload, id: string): Promise<InviteSummary> {
  assertAdmin(user);
  const row = await repo.findInviteById(id, user.schoolId);
  if (!row || !row.email) throw new AppError(404, "not_found", "Приглашение на почту не найдено");
  if (row.revokedAt) throw new AppError(409, "invite_revoked", "Приглашение отозвано — создайте новое");
  if (row.maxUses !== null && row.useCount >= row.maxUses) throw new AppError(409, "invite_used", "Приглашение уже принято");
  const rawCode = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + EMAIL_INVITE_DAYS * MS_PER_DAY);
  await repo.rotateInviteCode(row.id, hashInviteCode(rawCode), expiresAt);
  const sent = await emailInvite(user, { id: row.id, role: row.role, email: row.email, expiresAt }, rawCode);
  if (!sent) throw new AppError(502, "mail_failed", "Не удалось отправить письмо — попробуйте ещё раз через минуту");
  return toSummary({ ...row, expiresAt, sentAt: new Date() });
}

/**
 * Э15.2 — принять приглашение вошедшим аккаунтом (репетитор или участник
 * другой школы): второй аккаунт не нужен, к членству добавляется роль из
 * приглашения. Приглашение на почту — только для аккаунта с этим адресом.
 */
export async function acceptInvite(user: AccessTokenPayload, code: string): Promise<{ schoolId: string; roles: InviteSummary["role"][] }> {
  if (user.lessonScope) throw new AppError(403, "forbidden", "Недоступно в гостевой сессии");
  const codeHash = hashInviteCode(code);
  const info = await repo.findInviteWithSchoolByCodeHash(codeHash);
  if (!info) throw new AppError(404, "not_found", "Приглашение не найдено");
  const current = await membershipsService.getActive(user.sub, info.schoolId);
  if (current?.roles.includes(info.role)) return { schoolId: info.schoolId, roles: current.roles };
  const email = (await usersService.emailsByIds([user.sub])).get(user.sub)?.toLowerCase() ?? "";
  if (info.email && info.email !== email) {
    throw new AppError(403, "invite_other_email", "Приглашение отправлено на другой адрес почты — войдите в аккаунт с этим адресом");
  }
  await billingService.assertRoleSeat(info.schoolId, info.role);
  const invite = await repo.claimInvite(codeHash, email);
  if (!invite) throw new AppError(410, "invite_invalid", "Приглашение отозвано, просрочено или уже использовано");
  try {
    const roles = await membershipsService.grantRole(user.sub, invite.schoolId, invite.role);
    return { schoolId: invite.schoolId, roles };
  } catch (err) {
    await repo.releaseInvite(invite.id);
    throw err;
  }
}

/** Э15.6: регистрация по приглашению — есть ли место по тарифу (недействительное приглашение отклонит регистрация). */
export async function assertInviteSeat(code: string): Promise<void> {
  const info = await repo.findInviteWithSchoolByCodeHash(hashInviteCode(code));
  if (info) await billingService.assertRoleSeat(info.schoolId, info.role);
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

  return { schoolName: row.schoolName, schoolSlug: row.schoolSlug, role: row.role, valid, forEmail: row.email ? maskEmail(row.email) : null };
}

/** `anna@mail.ru` → `a***@mail.ru`: адрес узнаётся владельцем, но не раскрывается целиком. */
function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
}
