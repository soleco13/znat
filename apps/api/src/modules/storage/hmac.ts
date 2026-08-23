import { createHmac, timingSafeEqual } from "node:crypto";

function sign(storageKey: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${storageKey}:${exp}`).digest("base64url");
}

export function signStorageUrl(storageKey: string, ttlSeconds: number, secret: string) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = sign(storageKey, exp, secret);
  return { exp, sig };
}

export function verifyStorageSignature(
  storageKey: string,
  exp: number,
  sig: string,
  secret: string,
): boolean {
  if (Date.now() / 1000 > exp) return false;
  const expected = sign(storageKey, exp, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
