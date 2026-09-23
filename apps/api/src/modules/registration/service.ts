import { randomBytes, createHash } from "node:crypto";
import {
  slugify,
  type IndividualRegisterRequest,
  type OrganizationRegisterRequest,
  type RegisterResponse,
  type SchoolPublicInfo,
} from "@school/shared";
import { env } from "../../plugins/env.js";
import { AppError } from "../../plugins/errors.js";
import * as authService from "../auth/service.js";
import * as mailService from "../mail/service.js";
import * as repo from "./repo.js";

const VERIFICATION_TOKEN_TTL_HOURS = 24;
const SLUG_RETRY_LIMIT = 10;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
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
  const passwordHash = await authService.hashPassword(input.password);
  const rawToken = randomBytes(32).toString("base64url");
  const verificationExpiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);

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
      verificationTokenHash: hashToken(rawToken),
      verificationExpiresAt,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, "email_taken", "Пользователь с таким email уже существует");
    }
    throw err;
  }

  const verifyLink = `${env.PUBLIC_ORIGIN}/verify-email?token=${rawToken}`;
  await mailService.sendVerificationEmail(result.user.email, verifyLink);

  return { status: "pending_verification", email: result.user.email };
}

export async function registerIndividual(input: IndividualRegisterRequest): Promise<RegisterResponse> {
  if (input.inviteCode) {
    // Э14.2 доделает присоединение к чужому пространству по инвайт-ссылке.
    throw new AppError(501, "invite_not_supported_yet", "Присоединение по приглашению пока не реализовано");
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
    throw new AppError(404, "not_found", "Пользователь не найден");
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
