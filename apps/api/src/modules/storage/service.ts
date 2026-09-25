import { statfs } from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "./adapter.js";
import { LocalFsStorageAdapter } from "./local-fs.js";
import { signStorageUrl, verifyStorageSignature } from "./hmac.js";
import { env } from "../../plugins/env.js";
import { AppError } from "../../plugins/errors.js";
import { redis } from "../../db/redis.js";

const adapter: StorageAdapter = new LocalFsStorageAdapter(env.STORAGE_ROOT);

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 час

/**
 * Расширения, с которыми файл попадает в хранилище. Файлы `/files/*` отдаёт
 * Caddy, и тип содержимого он берёт по расширению: `evil.html` или `.svg` из
 * загрузки открылся бы страницей на домене приложения (хранимый XSS → угон
 * сессии через `/auth/refresh`). Всё, чего нет в списке, хранится как `.bin`
 * и отдаётся `application/octet-stream`.
 */
const SAFE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
  ".webm",
  ".mp4",
  ".pdf",
  ".pptx",
  ".odp",
  ".docx",
]);

export function safeStorageName(suggestedName: string): string {
  const ext = path.extname(suggestedName).toLowerCase();
  return `file${SAFE_EXTENSIONS.has(ext) ? ext : ".bin"}`;
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

function dailyUploadKey(schoolId: string, now: Date): string {
  return `upload:bytes:${schoolId}:${now.toISOString().slice(0, 10)}`;
}

/**
 * Две границы перед записью: свободное место на диске (общем с Postgres) и
 * суточный объём загрузок школы. Недоступный Redis суточный счётчик не
 * проверяет — загрузка картинки на урок важнее учёта.
 */
async function assertUploadAllowed(schoolId: string, now: Date): Promise<void> {
  const { freeBytes } = await getDiskUsage();
  if (freeBytes < env.STORAGE_MIN_FREE_GB * GB) {
    throw new AppError(507, "storage_full", "Хранилище заполнено — загрузка временно недоступна");
  }
  let used = 0;
  try {
    used = Number(await redis.get(dailyUploadKey(schoolId, now))) || 0;
  } catch {
    return;
  }
  if (used >= env.SCHOOL_DAILY_UPLOAD_MB * MB) {
    throw new AppError(429, "upload_quota_exceeded", "Школа исчерпала суточный объём загрузок — попробуйте завтра");
  }
}

async function recordUpload(schoolId: string, bytes: number, now: Date): Promise<void> {
  const key = dailyUploadKey(schoolId, now);
  try {
    await redis.incrby(key, bytes);
    await redis.expire(key, 2 * 24 * 60 * 60);
  } catch {
    // учёт — не критичный путь
  }
}

export async function uploadFile(input: {
  stream: NodeJS.ReadableStream;
  suggestedName: string;
  schoolId: string;
}) {
  const now = new Date();
  await assertUploadAllowed(input.schoolId, now);
  const result = await adapter.put({ ...input, suggestedName: safeStorageName(input.suggestedName) });
  await recordUpload(input.schoolId, result.sizeBytes, now);
  return result;
}

/**
 * Путь файла для `X-Accel-Redirect` — относительно тома хранилища, который
 * смонтирован в Caddy. Ключ приходит из подписанной ссылки, но подпись — не
 * повод доверять пути: `..` и абсолютные пути отбрасываем.
 */
export function getProxyFilePath(storageKey: string): string {
  const normalized = path.posix.normalize(storageKey);
  if (normalized !== storageKey || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error("Invalid storage key");
  }
  return "/" + normalized.split("/").map(encodeURIComponent).join("/");
}

export async function openFile(storageKey: string) {
  return adapter.get(storageKey);
}

/** Копия существующего файла под новым ключом — дедуп презентаций (Э4.5). */
export async function copyFile(input: { sourceKey: string; schoolId: string }) {
  return adapter.copy(input);
}

export async function deleteFile(storageKey: string) {
  return adapter.remove(storageKey);
}

export function getSignedFileUrl(storageKey: string, ttlSeconds: number = SIGNED_URL_TTL_SECONDS): string {
  const { exp, sig } = signStorageUrl(storageKey, ttlSeconds, env.STORAGE_HMAC_SECRET);
  const encodedKey = encodeURIComponent(storageKey);
  return `/files/${encodedKey}?exp=${exp}&sig=${sig}`;
}

export function verifyFileSignature(storageKey: string, exp: number, sig: string): boolean {
  return verifyStorageSignature(storageKey, exp, sig, env.STORAGE_HMAC_SECRET);
}

/**
 * Место на диске тома, где живёт `STORAGE_ROOT` (Node 22 — `fs.statfs`, тот
 * же системный вызов, что `df`). Только для `LocalFsStorageAdapter`: адаптер
 * захардкожен на файловую систему сейчас (см. выше) — для S3/SeaweedFS этот
 * вызов был бы бессмысленным (там своя квота, не диск этого хоста), но CI/
 * dependency-cruiser это не проверяют, так что если адаптер когда-нибудь
 * поменяют — эту функцию тоже придётся пересмотреть.
 */
export async function getDiskUsage(): Promise<{
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
}> {
  const stats = await statfs(env.STORAGE_ROOT);
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bavail * stats.bsize;
  return { totalBytes, freeBytes, usedBytes: totalBytes - freeBytes };
}
