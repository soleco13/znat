import { and, eq, desc, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { decks, deckSlides } from "../../db/schema.js";
import type { ConvertedSlide, DeckStatus } from "@school/shared";

export async function insertDeck(input: {
  schoolId: string;
  lessonId: string;
  sourceStorageKey: string;
  sourceSha256: string;
  sourceName: string;
  title: string;
  createdBy: string;
}) {
  const [row] = await db.insert(decks).values(input).returning();
  return row;
}

export async function findReadyDeckBySha(schoolId: string, sourceSha256: string) {
  const rows = await db
    .select()
    .from(decks)
    .where(
      and(
        eq(decks.schoolId, schoolId),
        eq(decks.sourceSha256, sourceSha256),
        eq(decks.status, "ready"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findDeckById(id: string) {
  const rows = await db.select().from(decks).where(eq(decks.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listDecksByLesson(lessonId: string) {
  return db.select().from(decks).where(eq(decks.lessonId, lessonId)).orderBy(desc(decks.createdAt));
}

export async function listSlidesByDeck(deckId: string) {
  return db
    .select()
    .from(deckSlides)
    .where(eq(deckSlides.deckId, deckId))
    .orderBy(deckSlides.index);
}

export async function listSlidesForDecks(deckIds: string[]) {
  if (deckIds.length === 0) return [];
  return db
    .select()
    .from(deckSlides)
    .where(inArray(deckSlides.deckId, deckIds))
    .orderBy(deckSlides.index);
}

export async function setDeckStatus(
  id: string,
  patch: { status?: DeckStatus; progress?: number; slideCount?: number; error?: string | null },
) {
  await db
    .update(decks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(decks.id, id));
}

/** Заменяет слайды презентации целиком (результат конвертации). */
export async function replaceDeckSlides(deckId: string, slides: ConvertedSlide[]) {
  await db.transaction(async (tx) => {
    await tx.delete(deckSlides).where(eq(deckSlides.deckId, deckId));
    if (slides.length > 0) {
      await tx.insert(deckSlides).values(
        slides.map((s) => ({
          deckId,
          index: s.index,
          imageStorageKey: s.imageStorageKey,
          thumbStorageKey: s.thumbStorageKey,
          width: s.width,
          height: s.height,
          textLayer: s.textLayer,
        })),
      );
    }
  });
}

export async function deleteDeck(id: string) {
  await db.delete(decks).where(eq(decks.id, id));
}
