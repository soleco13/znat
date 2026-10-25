import { asc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { schools } from "../../db/schema.js";

export async function getRawSettings(schoolId: string): Promise<unknown> {
  const [row] = await db
    .select({ settings: schools.settings })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  return row?.settings ?? {};
}

export async function updateRawSettings(schoolId: string, settings: unknown): Promise<void> {
  await db.update(schools).set({ settings }).where(eq(schools.id, schoolId));
}

/** Служебное пространство сервиса (`kind = 'platform'`). Если заведено несколько по ошибке — берём самое раннее. */
export async function findPlatformSchool(): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: schools.id, name: schools.name })
    .from(schools)
    .where(eq(schools.kind, "platform"))
    .orderBy(asc(schools.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Э15.5: завести пространство библиотеки «Матиса». Адрес без проверки
 * занятости: дефолтный `space-xxxxxxxx` уникален, а публичных путей у этого
 * пространства нет.
 */
export async function insertPlatformSchool(): Promise<{ id: string; name: string }> {
  const [row] = await db
    .insert(schools)
    .values({ name: "Библиотека Матиса", kind: "platform" })
    .returning({ id: schools.id, name: schools.name });
  return row!;
}

export async function findSchoolName(schoolId: string): Promise<string | null> {
  const [row] = await db.select({ name: schools.name }).from(schools).where(eq(schools.id, schoolId)).limit(1);
  return row?.name ?? null;
}

/** Э15.4: блокировка пространства супер-админом. */
export async function setBlocked(schoolId: string, blocked: boolean): Promise<boolean> {
  const rows = await db
    .update(schools)
    .set({ blockedAt: blocked ? new Date() : null })
    .where(eq(schools.id, schoolId))
    .returning({ id: schools.id });
  return rows.length > 0;
}
