import { randomUUID, randomBytes, createHash } from "node:crypto";
import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { accessTokenPayloadSchema, type AccessTokenPayload, type Role } from "@school/shared";
import { env } from "../../plugins/env.js";
import { AppError } from "../../plugins/errors.js";
import * as repo from "./repo.js";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_DAYS = 30;

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

export async function login(email: string, password: string) {
  const user = await repo.findUserByEmail(email);
  if (!user || !user.isActive) {
    throw new AppError(401, "invalid_credentials", "Неверный email или пароль");
  }
  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) {
    throw new AppError(401, "invalid_credentials", "Неверный email или пароль");
  }
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

export async function refresh(presentedToken: string) {
  const presentedHash = hashOpaqueToken(presentedToken);
  const record = await repo.findRefreshTokenByHash(presentedHash);

  if (!record) {
    throw new AppError(401, "invalid_refresh_token", "Недействительный refresh-токен");
  }
  if (record.revokedAt) {
    // Токен уже был использован для ротации — это повторное предъявление,
    // возможный признак кражи. Отзываем всю цепочку токенов.
    await repo.revokeFamily(record.familyId);
    throw new AppError(401, "refresh_token_reused", "Обнаружено повторное использование токена");
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw new AppError(401, "refresh_token_expired", "Срок действия токена истёк");
  }

  const user = await repo.findUserById(record.userId);
  if (!user || !user.isActive) {
    throw new AppError(401, "invalid_credentials", "Пользователь недоступен");
  }

  const nextRefresh = await issueRefreshToken(user.id, record.familyId);
  await repo.rotateRefreshToken({
    oldTokenHash: presentedHash,
    newTokenHash: hashOpaqueToken(nextRefresh.token),
  });

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
