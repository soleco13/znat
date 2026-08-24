import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { canvasDocs } from "../../db/schema.js";

/** Бинарное состояние Y.Doc урока, или null — если ещё ни разу не сохранялось (доска пустая). */
export async function loadDoc(lessonId: string): Promise<Buffer | null> {
  const rows = await db.select().from(canvasDocs).where(eq(canvasDocs.lessonId, lessonId)).limit(1);
  return rows[0]?.ydoc ?? null;
}

export async function saveDoc(lessonId: string, ydoc: Buffer): Promise<void> {
  await db
    .insert(canvasDocs)
    .values({ lessonId, ydoc, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: canvasDocs.lessonId,
      set: { ydoc, updatedAt: new Date() },
    });
}
