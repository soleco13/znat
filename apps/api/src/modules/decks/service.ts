/**
 * Презентации урока (Э4). Единственный экспорт модуля.
 *
 * Пайплайн: `createDeckFromUpload` сохраняет исходник через StorageAdapter,
 * заводит строку `decks` и ставит задачу в очередь `deck-convert` (модуль
 * `jobs`). Воркер (`services/converter`, отдельный контейнер) рендерит слайды
 * и возвращает результат; события очереди приходят сюда через
 * `buildConvertJobHandlers()`, которые пишут слайды в БД. Воркер БД не видит.
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  deckSourceMimeTypeSchema,
  type AccessTokenPayload,
  type Deck,
  type DeckSlide,
  type DeckUploadResponse,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as lessonsService from "../lessons/service.js";
import * as usersService from "../users/service.js";
import * as storageService from "../storage/service.js";
import * as jobsService from "../jobs/service.js";
import type { ConvertJobHandlers } from "../jobs/service.js";
import * as repo from "./repo.js";

/** Слайды доски видны только во время активного урока — тот же длинный TTL,
 *  что у изображений доски (Э3.10): ссылка кладётся в ответ и переживает урок. */
const SLIDE_URL_TTL_SECONDS = 60 * 60 * 24 * 30;

const EXT_BY_MIME: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.oasis.opendocument.presentation": ".odp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/pdf": ".pdf",
};

/** Только учитель-хозяин урока или админ — грузить/удалять презентации. */
async function assertCanManageLesson(user: AccessTokenPayload, lessonId: string) {
  const lesson = await lessonsService.getLesson(user.schoolId, lessonId);
  if (user.role === "admin") return lesson;
  if (user.role === "teacher" && lesson.teacherId === user.sub) return lesson;
  throw new AppError(403, "forbidden", "Управлять презентациями урока может только его учитель");
}

/** Любой участник урока — смотреть презентации. */
async function assertLessonViewer(user: AccessTokenPayload, lessonId: string) {
  const lesson = await lessonsService.getLesson(user.schoolId, lessonId);
  if (user.role === "admin") return lesson;
  if (user.role === "teacher" && lesson.teacherId === user.sub) return lesson;
  if (user.role === "student" && (await usersService.isGroupMember(lesson.groupId, user.sub))) {
    return lesson;
  }
  throw new AppError(403, "forbidden", "Нет доступа к этому уроку");
}

export async function createDeckFromUpload(input: {
  user: AccessTokenPayload;
  lessonId: string;
  buffer: Buffer;
  filename: string;
  mimeType: string;
}): Promise<DeckUploadResponse> {
  await assertCanManageLesson(input.user, input.lessonId);

  const parsedMime = deckSourceMimeTypeSchema.safeParse(input.mimeType);
  if (!parsedMime.success) {
    throw new AppError(
      400,
      "unsupported_type",
      "Поддерживаются PPTX, ODP, DOCX и PDF",
    );
  }
  const mimeType = parsedMime.data;

  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const ext = EXT_BY_MIME[mimeType] ?? "";

  const { storageKey } = await storageService.uploadFile({
    stream: Readable.from(input.buffer),
    suggestedName: `deck${ext}`,
    schoolId: input.user.schoolId,
  });

  const deck = await repo.insertDeck({
    schoolId: input.user.schoolId,
    lessonId: input.lessonId,
    sourceStorageKey: storageKey,
    sourceMimeType: mimeType,
    sourceSha256: sha256,
    sourceName: input.filename,
    title: input.filename.replace(/\.[^.]+$/, ""),
    createdBy: input.user.sub,
  });
  if (!deck) throw new AppError(500, "deck_create_failed", "Не удалось создать презентацию");

  await jobsService.enqueueConvert({
    deckId: deck.id,
    schoolId: deck.schoolId,
    sourceStorageKey: storageKey,
    sourceMimeType: mimeType,
  });

  return { deckId: deck.id, jobId: deck.id, status: "pending" };
}

type DeckRow = NonNullable<Awaited<ReturnType<typeof repo.findDeckById>>>;
type SlideRow = Awaited<ReturnType<typeof repo.listSlidesByDeck>>[number];

function toSlideDto(s: SlideRow): DeckSlide {
  return {
    index: s.index,
    imageUrl: storageService.getSignedFileUrl(s.imageStorageKey, SLIDE_URL_TTL_SECONDS),
    thumbUrl: storageService.getSignedFileUrl(s.thumbStorageKey, SLIDE_URL_TTL_SECONDS),
    width: s.width,
    height: s.height,
  };
}

function toDeckDto(deck: DeckRow, slides: SlideRow[]): Deck {
  return {
    id: deck.id,
    lessonId: deck.lessonId,
    title: deck.title,
    status: deck.status,
    slideCount: deck.slideCount,
    progress: deck.progress,
    error: deck.error,
    createdAt: deck.createdAt.toISOString(),
    slides: slides.map(toSlideDto),
  };
}

export async function listDecks(user: AccessTokenPayload, lessonId: string): Promise<Deck[]> {
  await assertLessonViewer(user, lessonId);
  const rows = await repo.listDecksByLesson(lessonId);
  const slides = await repo.listSlidesForDecks(rows.map((d) => d.id));
  const byDeck = new Map<string, typeof slides>();
  for (const s of slides) {
    const list = byDeck.get(s.deckId) ?? [];
    list.push(s);
    byDeck.set(s.deckId, list);
  }
  return rows.map((d) => toDeckDto(d, byDeck.get(d.id) ?? []));
}

export async function getDeckStatus(
  user: AccessTokenPayload,
  deckId: string,
): Promise<Pick<Deck, "status" | "progress" | "slideCount" | "error">> {
  const deck = await repo.findDeckById(deckId);
  if (!deck) throw new AppError(404, "not_found", "Презентация не найдена");
  await assertLessonViewer(user, deck.lessonId);
  return {
    status: deck.status,
    progress: deck.progress,
    slideCount: deck.slideCount,
    error: deck.error,
  };
}

export async function deleteDeck(
  user: AccessTokenPayload,
  lessonId: string,
  deckId: string,
): Promise<void> {
  await assertCanManageLesson(user, lessonId);
  const deck = await repo.findDeckById(deckId);
  if (!deck || deck.lessonId !== lessonId) {
    throw new AppError(404, "not_found", "Презентация не найдена");
  }
  const slides = await repo.listSlidesByDeck(deckId);
  await repo.deleteDeck(deckId); // deck_slides — ON DELETE CASCADE
  // Файлы чистим после строки БД: осиротевший файл в хранилище безопаснее,
  // чем строка БД со ссылкой на удалённый файл.
  for (const s of slides) {
    await storageService.deleteFile(s.imageStorageKey).catch(() => {});
    await storageService.deleteFile(s.thumbStorageKey).catch(() => {});
  }
  await storageService.deleteFile(deck.sourceStorageKey).catch(() => {});
}

/**
 * Обработчики событий очереди `deck-convert`. Регистрируются в `server.ts`
 * через `jobsService.startConvertEvents(...)`. deckId === jobId.
 */
export function buildConvertJobHandlers(): ConvertJobHandlers {
  return {
    async onProgress(deckId, progress) {
      await repo.setDeckStatus(deckId, {
        status: "converting",
        progress: progress.done,
        slideCount: progress.total,
      });
    },
    async onCompleted(deckId, result) {
      await repo.replaceDeckSlides(deckId, result.slides);
      await repo.setDeckStatus(deckId, {
        status: "ready",
        progress: result.slideCount,
        slideCount: result.slideCount,
        error: null,
      });
    },
    async onFailed(deckId, reason) {
      await repo.setDeckStatus(deckId, { status: "failed", error: reason.slice(0, 2000) });
    },
  };
}

// ─── Reconcile: страховка от пропущенного события очереди ─────────────────
// Событие `completed`/`failed` теряется, если `apps/api` рестартовал ровно
// когда воркер закончил задачу — презентация зависнет в `converting`
// навсегда. Свип (как `startPresenceSweep`/`startCanvasUnloadSweep`) раз в
// минуту сверяет застрявшие decks с реальным состоянием задачи.

const RECONCILE_INTERVAL_MS = 60_000;
let reconcileTimer: NodeJS.Timeout | null = null;

export async function reconcileStuckDecks(): Promise<void> {
  const stuck = await repo.listUnfinishedDecks();
  if (stuck.length === 0) return;
  const handlers = buildConvertJobHandlers();

  for (const deck of stuck) {
    try {
      const outcome = await jobsService.getConvertJobOutcome(deck.id);
      if (outcome.kind === "completed") {
        await handlers.onCompleted(deck.id, outcome.result);
      } else if (outcome.kind === "failed") {
        await handlers.onFailed(deck.id, outcome.reason);
      } else if (outcome.kind === "missing") {
        const mime = deckSourceMimeTypeSchema.safeParse(deck.sourceMimeType);
        if (deck.status === "pending" && mime.success) {
          // Задача так и не появилась в Redis (потеряна до старта) — переставить.
          await jobsService.enqueueConvert({
            deckId: deck.id,
            schoolId: deck.schoolId,
            sourceStorageKey: deck.sourceStorageKey,
            sourceMimeType: mime.data,
          });
        } else {
          await handlers.onFailed(
            deck.id,
            "Задача конвертации потеряна — перезагрузите презентацию",
          );
        }
      }
      // in-progress — ничего, дождёмся события или следующего свипа.
    } catch (err) {
      console.error("decks: reconcile failed", deck.id, err);
    }
  }
}

export function startDeckReconcileSweep(): void {
  if (reconcileTimer) return;
  void reconcileStuckDecks().catch((err: unknown) => {
    console.error("decks: initial reconcile failed", err);
  });
  reconcileTimer = setInterval(() => {
    void reconcileStuckDecks().catch((err: unknown) => {
      console.error("decks: reconcile sweep failed", err);
    });
  }, RECONCILE_INTERVAL_MS);
  reconcileTimer.unref?.();
}

export function stopDeckReconcileSweep(): void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
}
