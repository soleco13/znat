import { isNotNull, eq } from "drizzle-orm";
import type { AccessTokenPayload } from "@school/shared";
import { db } from "../db/client.js";
import { schools, users } from "../db/schema.js";
import { AppError } from "./errors.js";

/**
 * Э15.4 — блокировки супер-админа на каждом запросе (docs/roles §2). Access-
 * токен живёт 15 минут и проверяется без базы, поэтому заблокированные
 * пространства и аккаунты держим в кеше процесса: перечитываем раз в 30 с,
 * а после блокировки из «Платформы» — сразу (`invalidateBlocklist`). Кеш
 * можно потерять — он восстановится из базы при следующем запросе.
 */
const TTL_MS = 30_000;
interface Blocklist {
  at: number;
  schools: Set<string>;
  users: Set<string>;
}
let cache: Blocklist | null = null;
let loading: Promise<Blocklist> | null = null;

async function load(): Promise<Blocklist> {
  const [s, u] = await Promise.all([
    db.select({ id: schools.id }).from(schools).where(isNotNull(schools.blockedAt)),
    db.select({ id: users.id }).from(users).where(eq(users.isActive, false)),
  ]);
  const next: Blocklist = { at: Date.now(), schools: new Set(s.map((r) => r.id)), users: new Set(u.map((r) => r.id)) };
  cache = next;
  return next;
}

async function current(): Promise<Blocklist> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  loading ??= load().finally(() => {
    loading = null;
  });
  return loading;
}

export function invalidateBlocklist(): void {
  cache = null;
}

export async function isSchoolBlocked(schoolId: string): Promise<boolean> {
  return (await current()).schools.has(schoolId);
}

/** Аккаунт заблокирован — 401 (как истёкшая сессия); пространство — 403, кроме супер-админа. */
export async function assertNotBlocked(user: AccessTokenPayload): Promise<void> {
  const c = await current();
  if (c.users.has(user.sub) && !user.lessonScope) {
    throw new AppError(401, "account_blocked", "Аккаунт заблокирован — обратитесь в поддержку");
  }
  if (c.schools.has(user.schoolId) && !user.superAdmin) {
    throw new AppError(403, "space_blocked", "Пространство заблокировано — обратитесь в поддержку");
  }
}
