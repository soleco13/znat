import { statfs } from "node:fs/promises";
import type { StorageAdapter } from "./adapter.js";
import { LocalFsStorageAdapter } from "./local-fs.js";
import { signStorageUrl, verifyStorageSignature } from "./hmac.js";
import { env } from "../../plugins/env.js";

const adapter: StorageAdapter = new LocalFsStorageAdapter(env.STORAGE_ROOT);

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 час

export async function uploadFile(input: {
  stream: NodeJS.ReadableStream;
  suggestedName: string;
  schoolId: string;
}) {
  return adapter.put(input);
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
