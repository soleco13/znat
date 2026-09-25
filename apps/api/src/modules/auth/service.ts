import { randomUUID, randomBytes, createHash } from "node:crypto";
import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { accessTokenPayloadSchema, type AccessTokenPayload, type Role } from "@school/shared";
import { redis } from "../../db/redis.js";
import { env } from "../../plugins/env.js";
import * as mailService from "../mail/service.js";
import { AppError } from "../../plugins/errors.js";
import * as repo from "./repo.js";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_DAYS = 30;
/** Окно, в которое повторное предъявление только что ротированного refresh-токена считается гонкой вкладок, а не кражей. */
const REFRESH_REUSE_GRACE_MS = 30_000;

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function issueAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(accessSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, accessSecret);
  return accessTokenPayloadSchema.parse(payload);
}

async function issueRefreshToken(userId: string, familyId: string) {
  const token = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await repo.insertRefreshToken({
    userId,
    familyId,
    tokenHash: hashOpaqueToken(token),
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * Э14.1 — минт новой сессии (access + refresh, новая `familyId`) для уже
 * аутентифицированного пользователя. Общая точка для `login()` и
 * подтверждения почты при self-signup (`registration` модуль) — токены не
 * дублируются в двух местах.
 */
export async function issueSessionForUser<T extends { id: string; schoolId: string; role: string }>(
  user: T,
) {
  await repo.touchLastLogin(user.id);

  const familyId = randomUUID();
  const accessToken = await issueAccessToken({
    sub: user.id,
    schoolId: user.schoolId,
    role: user.role as Role,
  });
  const refresh = await issueRefreshToken(user.id, familyId);

  return { accessToken, refreshToken: refresh.token, refreshExpiresAt: refresh.expiresAt, user };
}

/**
 * Подбор пароля к одному аккаунту с разных IP лимит по IP не сдерживает —
 * считаем неудачи на сам email: 10 за 15 минут, дальше 429 до конца окна.
 * Проверка до argon2: перебор ещё и не жжёт CPU на хэширование.
 */
const LOGIN_FAILURES_LIMIT = 10;
const LOGIN_FAILURES_WINDOW_SECONDS = 15 * 60;

function loginFailuresKey(email: string): string {
  return `login:fail:${email}`;
}

async function assertLoginNotThrottled(email: string): Promise<void> {
  let failures = 0;
  try {
    failures = Number(await redis.get(loginFailuresKey(email))) || 0;
  } catch {
    return;
  }
  if (failures >= LOGIN_FAILURES_LIMIT) {
    throw new AppError(429, "too_many_login_attempts", "Слишком много неудачных попыток входа — попробуйте через 15 минут");
  }
}

async function recordLoginFailure(email: string): Promise<void> {
  try {
    const n = await redis.incr(loginFailuresKey(email));
    if (n === 1) await redis.expire(loginFailuresKey(email), LOGIN_FAILURES_WINDOW_SECONDS);
  } catch {
    // учёт попыток — не критичный путь
  }
}

export async function login(email: string, password: string) {
  await assertLoginNotThrottled(email);
  try {
    return await loginUnthrottled(email, password);
  } catch (err) {
    if (err instanceof AppError && err.code === "invalid_credentials") await recordLoginFailure(email);
    throw err;
  }
}

async function loginUnthrottled(email: string, password: string) {
  const user = await repo.findUserByEmail(email);
  if (!user || !user.isActive) {
    throw new AppError(401, "invalid_credentials", "Неверный email или пароль");
  }
  // Э14.1: passwordHash nullable (задел под OAuth-only аккаунты, Э14.3) —
  // без этой проверки argon2.verify(null, ...) кинул бы сырой TypeError.
  if (!user.passwordHash) {
    throw new AppError(401, "invalid_credentials", "Неверный email или пароль");
  }
  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) {
    throw new AppError(401, "invalid_credentials", "Неверный email или пароль");
  }
  // Проверка после пароля: иначе ответ выдавал бы, что аккаунт с таким
  // email существует. Без неё подтверждение почты ничего не значило —
  // зарегистрироваться на чужой адрес и сразу войти мог кто угодно.
  if (!user.emailVerifiedAt) {
    throw new AppError(403, "email_not_verified", "Почта не подтверждена — перейдите по ссылке из письма");
  }
  await redis.del(loginFailuresKey(email)).catch(() => undefined);
  return issueSessionForUser(user);
}

export async function refresh(presentedToken: string) {
  const presentedHash = hashOpaqueToken(presentedToken);
  const record = await repo.findRefreshTokenByHash(presentedHash);

  if (!record) {
    throw new AppError(401, "invalid_refresh_token", "Недействительный refresh-токен");
  }
  if (record.revokedAt) {
    // Только что ротирован (есть преемник, прошло меньше окна) — это вторая
    // вкладка или проснувшийся ноутбук, отправившие тот же токен почти
    // одновременно, а не кража. Раньше такая гонка отзывала всю цепочку и
    // выбрасывала учителя из всех вкладок посреди урока.
    const justRotated =
      record.replacedByHash !== null && Date.now() - record.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS;
    if (!justRotated) {
      // Повторное предъявление давно использованного токена — возможный
      // признак кражи. Отзываем всю цепочку токенов.
      await repo.revokeFamily(record.familyId);
      throw new AppError(401, "refresh_token_reused", "Обнаружено повторное использование токена");
    }
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw new AppError(401, "refresh_token_expired", "Срок действия токена истёк");
  }

  const user = await repo.findUserById(record.userId);
  if (!user || !user.isActive) {
    throw new AppError(401, "invalid_credentials", "Пользователь недоступен");
  }

  const nextRefresh = await issueRefreshToken(user.id, record.familyId);
  if (!record.revokedAt) {
    await repo.rotateRefreshToken({
      oldTokenHash: presentedHash,
      newTokenHash: hashOpaqueToken(nextRefresh.token),
    });
  }

  const accessToken = await issueAccessToken({
    sub: user.id,
    schoolId: user.schoolId,
    role: user.role as Role,
  });

  return {
    accessToken,
    refreshToken: nextRefresh.token,
    refreshExpiresAt: nextRefresh.expiresAt,
    user,
  };
}

export async function logout(presentedToken: string) {
  const presentedHash = hashOpaqueToken(presentedToken);
  const record = await repo.findActiveRefreshToken(presentedHash);
  if (record) {
    await repo.revokeFamily(record.familyId);
  }
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function getUserOrThrow(userId: string) {
  const user = await repo.findUserById(userId);
  if (!user) {
    throw new AppError(404, "not_found", "Пользователь не найден");
  }
  return user;
}

const REFRESH_TOKEN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let refreshTokenCleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Ротация добавляет строку `refresh_tokens` на каждое обновление токена
 * (раз в ~15 минут на вкладку), а удаления не было вовсе — таблица росла
 * бесконечно. Чистим истёкшие раз в час.
 */
export async function runRefreshTokenCleanupOnce(): Promise<number> {
  return repo.deleteExpiredRefreshTokens(new Date());
}

export function startRefreshTokenCleanup(): void {
  if (refreshTokenCleanupTimer) return;
  refreshTokenCleanupTimer = setInterval(() => {
    runRefreshTokenCleanupOnce().catch((err) => console.error("auth: refresh token cleanup failed", err));
  }, REFRESH_TOKEN_CLEANUP_INTERVAL_MS);
  refreshTokenCleanupTimer.unref?.();
}

export function stopRefreshTokenCleanup(): void {
  if (refreshTokenCleanupTimer) {
    clearInterval(refreshTokenCleanupTimer);
    refreshTokenCleanupTimer = null;
  }
}

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
/** Не чаще одного письма сброса в минуту на адрес. */
const PASSWORD_RESET_COOLDOWN_SECONDS = 60;

/**
 * «Забыли пароль?». Ответ одинаковый, есть такой аккаунт или нет, — по
 * эндпоинту нельзя перебирать зарегистрированные адреса. Сбой SMTP только
 * логируется по той же причине.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const cooldown = await redis.set(`mail:reset:${email}`, "1", "EX", PASSWORD_RESET_COOLDOWN_SECONDS, "NX");
  if (cooldown !== "OK") return;
  const user = await repo.findUserByEmail(email);
  if (!user || !user.isActive) return;
  const rawToken = randomBytes(32).toString("base64url");
  await repo.insertPasswordResetToken({
    userId: user.id,
    tokenHash: hashOpaqueToken(rawToken),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
  });
  try {
    await mailService.sendPasswordResetEmail(user.email, `${env.PUBLIC_ORIGIN}/reset-password?token=${rawToken}`);
  } catch (err) {
    console.error("auth: не удалось отправить письмо сброса пароля", err);
  }
}

/** Новый пароль по ссылке из письма; все прежние сессии отзываются. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  const user = await repo.consumePasswordReset(hashOpaqueToken(token), passwordHash, new Date());
  if (!user) {
    throw new AppError(400, "invalid_reset_token", "Ссылка недействительна, уже использована или истекла — запросите новую");
  }
}

/**
 * Смена пароля вошедшим пользователем. Остальные сессии (другие устройства,
 * возможно — чужие) отзываются, текущей выдаётся новая.
 */
export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await repo.findUserById(userId);
  if (!user || !user.isActive) {
    throw new AppError(401, "invalid_credentials", "Пользователь недоступен");
  }
  if (!user.passwordHash || !(await argon2.verify(user.passwordHash, currentPassword))) {
    throw new AppError(400, "wrong_current_password", "Текущий пароль указан неверно");
  }
  await repo.updatePasswordHash(user.id, await hashPassword(newPassword));
  await repo.revokeAllForUser(user.id);
  return issueSessionForUser(user);
}
