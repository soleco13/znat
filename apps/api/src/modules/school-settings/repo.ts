import { eq } from "drizzle-orm";
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
