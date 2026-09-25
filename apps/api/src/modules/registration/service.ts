import { randomBytes, createHash } from "node:crypto";
import {
  slugify,
  type IndividualRegisterRequest,
  type OrganizationRegisterRequest,
  type RegisterResponse,
  type SchoolPublicInfo,
} from "@school/shared";
import { redis } from "../../db/redis.js";
import { env } from "../../plugins/env.js";
import { AppError } from "../../plugins/errors.js";
import * as authService from "../auth/service.js";
import * as invitesService from "../invites/service.js";
import * as mailService from "../mail/service.js";
import * as repo from "./repo.js";

const VERIFICATION_TOKEN_TTL_HOURS = 24;
/** Неподтверждённый аккаунт живёт неделю, потом фоновая чистка его удаляет. */
const UNVERIFIED_ACCOUNT_TTL_DAYS = 7;
/** Не чаще одного письма в минуту на адрес — кнопка «отправить ещё раз» не превращается в рассылку. */
const RESEND_COOLDOWN_SECONDS = 60;
const SLUG_RETRY_LIMIT = 10;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

/**
 * Адрес занят неподтверждённым аккаунтом, чья ссылка уже истекла, — удаляем
 * его: иначе кто угодно мог навсегда занять чужой email, просто начав
 * регистрацию и не подтвердив её.
 */
async function freeEmailIfStale(email: string): Promise<void> {
  const stale = await repo.findUnverifiedUserByEmail(email);
  if (stale) await repo.deleteStaleUnverifiedUser(stale.id, new Date());
}

function newVerificationToken() {
  const rawToken = randomBytes(32).toString("base64url");
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000),
  };
}

/**
 * Письмо уходит после коммита регистрации. Раньше сбой SMTP давал 500 уже
 * созданному аккаунту — человек не получал ни письма, ни способа его
 * запросить. Теперь сбой только логируется: письмо можно запросить снова.
 */
async function sendVerificationLink(email: string, rawToken: string): Promise<void> {
  const verifyLink = `${env.PUBLIC_ORIGIN}/verify-email?token=${rawToken}`;
  try {
    await mailService.sendVerificationEmail(email, verifyLink);
  } catch (err) {
    console.error("registration: не удалось отправить письмо подтверждения", err);
  }
}

async function generateUniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "space";
  let candidate = root;
  for (let attempt = 0; attempt < SLUG_RETRY_LIMIT; attempt += 1) {
    if (!(await repo.slugExists(candidate))) {
      return candidate;
    }
    candidate = `${root}-${randomBytes(3).toString("hex")}`;
  }
  throw new AppError(500, "slug_generation_failed", "Не удалось сгенерировать уникальный адрес пространства");
}

async function registerAndSendVerification(input: {
  schoolName: string;
  slug: string;
  kind: "individual" | "organization";
  inn?: string;
  ogrn?: string;
  email: string;
  password: string;
  fullName: string;
}): Promise<RegisterResponse> {
  await freeEmailIfStale(input.email);
  const passwordHash = await authService.hashPassword(input.password);
  const { rawToken, tokenHash, expiresAt: verificationExpiresAt } = newVerificationToken();

  let result;
  try {
    result = await repo.registerSchoolWithAdmin({
      schoolName: input.schoolName,
      slug: input.slug,
      kind: input.kind,
      inn: input.inn,
      ogrn: input.ogrn,
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      role: "admin",
      verificationTokenHash: tokenHash,
      verificationExpiresAt,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, "email_taken", "Пользователь с таким email уже существует");
    }
    throw err;
  }

  await sendVerificationLink(result.user.email, rawToken);

  return { status: "pending_verification", email: result.user.email };
}

/** Э14.2 — присоединение к чужому пространству по инвайту (роль/школа берутся из самого инвайта). */
async function joinViaInvite(
  inviteCode: string,
  input: { email: string; password: string; fullName: string },
): Promise<RegisterResponse> {
  await freeEmailIfStale(input.email);
  const passwordHash = await authService.hashPassword(input.password);
  const { rawToken, tokenHash, expiresAt: verificationExpiresAt } = newVerificationToken();

  let result;
  try {
    result = await repo.joinSchoolViaInvite({
      inviteCodeHash: invitesService.hashInviteCode(inviteCode),
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      verificationTokenHash: tokenHash,
      verificationExpiresAt,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, "email_taken", "Пользователь с таким email уже существует");
    }
    throw err;
  }
  if (!result) {
    throw new AppError(410, "invite_invalid", "Приглашение недействительно или уже использовано");
  }

  await sendVerificationLink(result.user.email, rawToken);

  return { status: "pending_verification", email: result.user.email };
}

export async function registerIndividual(input: IndividualRegisterRequest): Promise<RegisterResponse> {
  if (input.inviteCode) {
    return joinViaInvite(input.inviteCode, input);
  }

  const slug = await generateUniqueSlug(input.fullName);
  return registerAndSendVerification({
    schoolName: `Личное пространство — ${input.fullName}`,
    slug,
    kind: "individual",
    email: input.email,
    password: input.password,
    fullName: input.fullName,
  });
}

export async function registerOrganization(input: OrganizationRegisterRequest): Promise<RegisterResponse> {
  const slug = await generateUniqueSlug(input.orgName);
  return registerAndSendVerification({
    schoolName: input.orgName,
    slug,
    kind: "organization",
    inn: input.inn,
    ogrn: input.ogrn,
    email: input.email,
    password: input.password,
    fullName: input.fullName,
  });
}

export async function confirmEmail(token: string) {
  const record = await repo.findEmailVerificationTokenByHash(hashToken(token));
  if (!record) {
    throw new AppError(400, "invalid_token", "Недействительная ссылка подтверждения");
  }
  if (record.consumedAt) {
    throw new AppError(400, "token_already_used", "Ссылка уже была использована");
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw new AppError(400, "token_expired", "Срок действия ссылки истёк");
  }

  const user = await repo.consumeVerificationToken(record.id, record.userId);
  if (!user) {
    throw new AppError(400, "token_already_used", "Ссылка уже была использована");
  }

  return authService.issueSessionForUser(user);
}

export async function getSpacePublicInfo(slug: string): Promise<SchoolPublicInfo> {
  const school = await repo.findSchoolBySlug(slug);
  if (!school) {
    throw new AppError(404, "not_found", "Пространство не найдено");
  }
  return { id: school.id, name: school.name, slug: school.slug, kind: school.kind };
}

/**
 * «Отправить письмо ещё раз». Ответ один и тот же, есть такой аккаунт или
 * нет, — по этому эндпоинту нельзя перебирать, чьи адреса зарегистрированы.
 */
export async function resendVerification(email: string): Promise<void> {
  const cooldownSet = await redis.set(`mail:resend:${email}`, "1", "EX", RESEND_COOLDOWN_SECONDS, "NX");
  if (cooldownSet !== "OK") return;
  const user = await repo.findUnverifiedUserByEmail(email);
  if (!user) return;
  const { rawToken, tokenHash, expiresAt } = newVerificationToken();
  await repo.insertVerificationToken({ userId: user.id, tokenHash, expiresAt });
  await sendVerificationLink(user.email, rawToken);
}

const UNVERIFIED_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const UNVERIFIED_CLEANUP_BATCH = 500;
let unverifiedCleanupTimer: ReturnType<typeof setInterval> | null = null;

/** Удаляет брошенные неподтверждённые аккаунты (и их пустые пространства). Возвращает, сколько удалено. */
export async function runUnverifiedCleanupOnce(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - UNVERIFIED_ACCOUNT_TTL_DAYS * 24 * 60 * 60 * 1000);
  const ids = await repo.listUnverifiedUsersCreatedBefore(before, UNVERIFIED_CLEANUP_BATCH);
  let deleted = 0;
  for (const id of ids) {
    if (await repo.deleteStaleUnverifiedUser(id, now)) deleted++;
  }
  return deleted;
}

export function startUnverifiedCleanup(): void {
  if (unverifiedCleanupTimer) return;
  unverifiedCleanupTimer = setInterval(() => {
    runUnverifiedCleanupOnce().catch((err) => console.error("registration: unverified cleanup failed", err));
  }, UNVERIFIED_CLEANUP_INTERVAL_MS);
  unverifiedCleanupTimer.unref?.();
}

export function stopUnverifiedCleanup(): void {
  if (unverifiedCleanupTimer) {
    clearInterval(unverifiedCleanupTimer);
    unverifiedCleanupTimer = null;
  }
}
