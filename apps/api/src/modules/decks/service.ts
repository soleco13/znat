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
  type ConvertedSlide,
  type Deck,
  type DeckSlide,
  type DeckSourceMimeType,
  type DeckUploadResponse,
} from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import * as lessonsService from "../lessons/service.js";
import * as usersService from "../users/service.js";
import * as storageService from "../storage/service.js";
import * as jobsService from "../jobs/service.js";
import type { ConvertJobHandlers } from "../jobs/service.js";
import * as roomsService from "../rooms/service.js";
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
  if (
    user.role === "student" &&
    lesson.groupId !== null &&
    (await usersService.isGroupMember(lesson.groupId, user.sub))
  ) {
    return lesson;
  }
  throw new AppError(403, "forbidden", "Нет доступа к этому уроку");
}

/**
 * Э4.4: шлёт прогресс/статус презентации в WS-канал урока (`/ws`). Вызывается
 * из одной точки — после каждой записи статуса в БД — чтобы событие всегда
 * отражало то, что реально сохранено. `row` может быть `undefined`, если
 * строку `decks` успели удалить между постановкой и обработкой (учитель
 * удалил презентацию во время конвертации) — тогда слать нечего.
 */
function broadcastDeckStatus(row: Awaited<ReturnType<typeof repo.setDeckStatus>>): void {
  if (!row) return;
  roomsService.broadcastToLesson(row.lessonId, {
    type: "deck_status",
    deck: {
      deckId: row.id,
      title: row.title,
      status: row.status,
      progress: row.progress,
      slideCount: row.slideCount,
      error: row.error,
    },
  });
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

  // Э4.5: та же презентация (совпал sha256 исходника) уже сконвертирована в
  // этой школе — не гоняем LibreOffice второй раз, копируем готовые слайды.
  const twin = await repo.findReadyDeckBySha(input.user.schoolId, sha256);
  if (twin) {
    return dedupFromTwin({
      user: input.user,
      lessonId: input.lessonId,
      filename: input.filename,
      mimeType,
      sha256,
      sourceStorageKey: storageKey,
      twinId: twin.id,
      twinRenderMode: twin.renderMode === "pdf" ? "pdf" : "images",
      twinSlideCount: twin.slideCount,
    });
  }

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

  // Э4.4: сразу показать презентацию в списке урока со статусом «в очереди»,
  // не дожидаясь первого события прогресса от воркера.
  broadcastDeckStatus(deck);

  return { deckId: deck.id, jobId: deck.id, status: "pending" };
}

/**
 * Э4.5: заводит презентацию из уже готового «двойника» — той же презентации,
 * сконвертированной ранее (совпал sha256 исходника). Конвертация пропускается
 * целиком. Слайды двойника **копируются** под новыми ключами, а не
 * переиспользуются: каждый `deck` владеет своими файлами, поэтому `deleteDeck`
 * не нужен учёт ссылок. Расход диска на дубль ~несколько МБ на презентацию —
 * приемлемо для MVP; дорогой ресурс (CPU LibreOffice во время уроков) сэкономлен.
 */
async function dedupFromTwin(input: {
  user: AccessTokenPayload;
  lessonId: string;
  filename: string;
  mimeType: DeckSourceMimeType;
  sha256: string;
  sourceStorageKey: string;
  twinId: string;
  twinRenderMode: "images" | "pdf";
  twinSlideCount: number;
}): Promise<DeckUploadResponse> {
  const deckBase = {
    schoolId: input.user.schoolId,
    lessonId: input.lessonId,
    sourceStorageKey: input.sourceStorageKey,
    sourceMimeType: input.mimeType,
    sourceSha256: input.sha256,
    sourceName: input.filename,
    title: input.filename.replace(/\.[^.]+$/, ""),
    createdBy: input.user.sub,
  };

  // Э4.7: двойник — PDF, отдаваемый браузеру. Копировать нечего (слайдов нет),
  // ClamAV не нужен — тот же файл (совпал sha256) уже был просканирован.
  if (input.twinRenderMode === "pdf") {
    const deck = await repo.insertDeck(deckBase);
    if (!deck) throw new AppError(500, "deck_create_failed", "Не удалось создать презентацию");
    const row = await repo.setDeckStatus(deck.id, {
      status: "ready",
      renderMode: "pdf",
      progress: input.twinSlideCount,
      slideCount: input.twinSlideCount,
      error: null,
    });
    broadcastDeckStatus(row);
    return { deckId: deck.id, jobId: null, status: "ready" };
  }

  const twinSlides = await repo.listSlidesByDeck(input.twinId);
  const copied: ConvertedSlide[] = await Promise.all(
    twinSlides.map(async (s) => {
      const [image, thumb] = await Promise.all([
        storageService.copyFile({ sourceKey: s.imageStorageKey, schoolId: input.user.schoolId }),
        storageService.copyFile({ sourceKey: s.thumbStorageKey, schoolId: input.user.schoolId }),
      ]);
      return {
        index: s.index,
        imageStorageKey: image.storageKey,
        thumbStorageKey: thumb.storageKey,
        width: s.width,
        height: s.height,
        // textLayer/notes — наш же JSON/текст, записанные из ConvertedSlide при
        // конвертации двойника (Э4.5/Э4.8/Э4.9), не any.
        textLayer: s.textLayer as ConvertedSlide["textLayer"],
        notes: s.notes as ConvertedSlide["notes"],
      };
    }),
  );

  const deck = await repo.insertDeck(deckBase);
  if (!deck) throw new AppError(500, "deck_create_failed", "Не удалось создать презентацию");

  await repo.replaceDeckSlides(deck.id, copied);
  const row = await repo.setDeckStatus(deck.id, {
    status: "ready",
    progress: copied.length,
    slideCount: copied.length,
    error: null,
  });
  broadcastDeckStatus(row);

  return { deckId: deck.id, jobId: null, status: "ready" };
}

type DeckRow = NonNullable<Awaited<ReturnType<typeof repo.findDeckById>>>;
type SlideRow = Awaited<ReturnType<typeof repo.listSlidesByDeck>>[number];

/**
 * Э4.9: `includeNotes` решает не UI, а сервер — не учитель/админ этого урока
 * получает `notes: null` в самом ответе API, даже если заметки реально есть
 * в БД. Держать это в общем `Y.Doc` холста было бы утечкой: документ
 * реплицируется ВСЕМ подключённым клиентам целиком (read-only ограничивает
 * только запись, не чтение, см. находку про `connectionConfig.readOnly` в
 * Э3.1) — учитель читает заметки из этого DTO на своей стороне (Board.tsx),
 * никогда из общего документа.
 */
function toSlideDto(s: SlideRow, includeNotes: boolean): DeckSlide {
  return {
    index: s.index,
    imageUrl: storageService.getSignedFileUrl(s.imageStorageKey, SLIDE_URL_TTL_SECONDS),
    thumbUrl: storageService.getSignedFileUrl(s.thumbStorageKey, SLIDE_URL_TTL_SECONDS),
    width: s.width,
    height: s.height,
    // Наш же JSON, записанный из ConvertedSlide при конвертации (Э4.8) — не any.
    textLayer: (s.textLayer as ConvertedSlide["textLayer"]) ?? null,
    notes: includeNotes ? ((s.notes as ConvertedSlide["notes"]) ?? null) : null,
  };
}

function toDeckDto(deck: DeckRow, slides: SlideRow[], includeNotes: boolean): Deck {
  const renderMode = deck.renderMode === "pdf" ? "pdf" : "images";
  return {
    id: deck.id,
    lessonId: deck.lessonId,
    title: deck.title,
    status: deck.status,
    renderMode,
    slideCount: deck.slideCount,
    progress: deck.progress,
    error: deck.error,
    createdAt: deck.createdAt.toISOString(),
    slides: slides.map((s) => toSlideDto(s, includeNotes)),
    // Э4.7: PDF рендерит pdf.js в браузере — отдаём подписанный URL исходника
    // (тот же длинный TTL, что у слайдов). У обычных презентаций поле пустое.
    pdfUrl:
      renderMode === "pdf"
        ? storageService.getSignedFileUrl(deck.sourceStorageKey, SLIDE_URL_TTL_SECONDS)
        : null,
  };
}

export async function listDecks(user: AccessTokenPayload, lessonId: string): Promise<Deck[]> {
  const lesson = await assertLessonViewer(user, lessonId);
  const includeNotes = user.role === "admin" || (user.role === "teacher" && lesson.teacherId === user.sub);
  const rows = await repo.listDecksByLesson(lessonId);
  const slides = await repo.listSlidesForDecks(rows.map((d) => d.id));
  const byDeck = new Map<string, typeof slides>();
  for (const s of slides) {
    const list = byDeck.get(s.deckId) ?? [];
    list.push(s);
    byDeck.set(s.deckId, list);
  }
  return rows.map((d) => toDeckDto(d, byDeck.get(d.id) ?? [], includeNotes));
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
      const row = await repo.setDeckStatus(deckId, {
        status: "converting",
        progress: progress.done,
        slideCount: progress.total,
      });
      broadcastDeckStatus(row);
    },
    async onCompleted(deckId, result) {
      // Э4.7: PDF отдан браузеру как есть — воркер вернул только число страниц,
      // слайдов нет, рендерит pdf.js. Помечаем renderMode, слайды не пишем.
      const renderMode = result.pdf ? "pdf" : "images";
      await repo.replaceDeckSlides(deckId, result.pdf ? [] : result.slides);
      const row = await repo.setDeckStatus(deckId, {
        status: "ready",
        renderMode,
        progress: result.slideCount,
        slideCount: result.slideCount,
        error: null,
      });
      broadcastDeckStatus(row);
    },
    async onFailed(deckId, reason) {
      const row = await repo.setDeckStatus(deckId, { status: "failed", error: reason.slice(0, 2000) });
      broadcastDeckStatus(row);
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
