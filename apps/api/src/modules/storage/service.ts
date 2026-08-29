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
