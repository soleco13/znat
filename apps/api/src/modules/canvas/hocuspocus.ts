import {
  Hocuspocus,
  type beforeUnloadDocumentPayload,
  type connectedPayload,
  type onAuthenticatePayload,
  type onDisconnectPayload,
  type onLoadDocumentPayload,
  type onStoreDocumentPayload,
} from "@hocuspocus/server";
import { encodeStateAsUpdate } from "yjs";
import { z } from "zod";
import { AppError } from "../../plugins/errors.js";
import { verifyAccessToken } from "../auth/service.js";
import * as lessonsService from "../lessons/service.js";
import * as usersService from "../users/service.js";
import * as repo from "./repo.js";

const documentNameSchema = z.string().uuid();

/**
 * Проверяет права на lesson_id при подключении к Yjs-документу холста (Э3.1,
 * §3.4 ТЗ). documentName у Hocuspocus — это lessonId напрямую (`Y.Doc` один
 * на урок, отдельный namespace-префикс не нужен — коллизий имён документов
 * быть не может).
 *
 * Логика прав ролей намеренно ДУБЛИРУЕТ rooms/service.ts#assertMembership, а
 * не переиспользует её: canvas не должен зависеть от rooms (это
 * presence/WS-модуль, а не владелец правил доступа к уроку), а правило
 * модульности CLAUDE.md запрещает модулю тянуть чужой repo.ts — здесь
 * используются только публичные сервисы lessons/users, как и в rooms.
 */
export async function authenticateCanvasConnection(
  payload: Pick<onAuthenticatePayload, "token" | "documentName">,
): Promise<{ userId: string; role: string }> {
  const parsedLessonId = documentNameSchema.safeParse(payload.documentName);
  if (!parsedLessonId.success) {
    throw new AppError(400, "invalid_document", "Некорректный идентификатор урока");
  }
  const lessonId = parsedLessonId.data;

  const user = await verifyAccessToken(payload.token);
  const lesson = await lessonsService.getLesson(user.schoolId, lessonId);

  if (user.role === "admin") {
    return { userId: user.sub, role: user.role };
  }
  if (user.role === "teacher") {
    if (lesson.teacherId !== user.sub) {
      throw new AppError(403, "forbidden", "Вы не ведёте этот урок");
    }
    return { userId: user.sub, role: user.role };
  }
  if (user.role === "student") {
    const isMember = await usersService.isGroupMember(lesson.groupId, user.sub);
    if (!isMember) {
      throw new AppError(403, "forbidden", "Вы не состоите в группе этого урока");
    }
    return { userId: user.sub, role: user.role };
  }
  throw new AppError(403, "forbidden", "Роль не допускается к участию в уроке");
}

/**
 * Загружает сохранённое бинарное состояние Y.Doc из Postgres при первом
 * подключении к документу (Э3.2, §9 ТЗ: `canvas_docs.ydoc BYTEA`).
 * Возврат `Uint8Array` — Hocuspocus сам применит его через `applyUpdate` к
 * новому пустому `Document` (проверено чтением `Hocuspocus.ts#loadDocument`:
 * колбэк `onLoadDocument` проверяет `instanceof Doc` ИЛИ `instanceof
 * Uint8Array` — `Buffer` соответствует второму). Если строки в БД нет —
 * возвращаем `undefined`, тогда используется штатный пустой документ.
 */
export async function loadCanvasDocument(
  payload: Pick<onLoadDocumentPayload, "documentName">,
): Promise<Buffer | undefined> {
  const ydoc = await repo.loadDoc(payload.documentName);
  return ydoc ?? undefined;
}

/**
 * Сохраняет полное бинарное состояние Y.Doc в Postgres (upsert по
 * `lessonId`). Дебаунсится самим Hocuspocus (`debounce: 3000` в конфиге
 * ниже, §3.4 ТЗ: «дебаунс 2–5 сек», Э3.2 плана — буквально «3 сек») — сюда
 * попадают уже готовые к записи, не по каждому штриху.
 */
export async function storeCanvasDocument(
  payload: Pick<onStoreDocumentPayload, "documentName" | "document">,
): Promise<void> {
  const state = Buffer.from(encodeStateAsUpdate(payload.document));
  await repo.saveDoc(payload.documentName, state);
}

/** Э3.3 плана: выгрузка Y.Doc из памяти через 5 минут после ухода последнего участника. */
const UNLOAD_GRACE_MS = 5 * 60 * 1000;
const UNLOAD_SWEEP_INTERVAL_MS = 30_000;

/**
 * documentName -> момент, когда `document.getConnectionsCount()` последний
 * раз стал равен нулю. Своя карта, а не что-то встроенное в пакет —
 * **проверено чтением исходника, что штатного "unload delay"/"grace
 * period" механизма в Hocuspocus нет**: `shouldUnloadDocument()` в
 * `Hocuspocus.ts` считает документ выгружаемым сразу, как только у него 0
 * подключений и нет ожидающего дебаунсированного сохранения — то есть
 * штатно документ выгружается практически сразу (в пределах `debounce`/
 * `maxDebounce`, секунды), а не через 5 минут. Единственное найденное
 * связанное API — `DisconnectOptions.unloadImmediately` у `DirectConnection`
 * (см. types.ts) — это для программных серверных подключений
 * (`server-side transact`), а не для обычных WS-клиентов урока, для нашего
 * случая не подходит.
 */
const emptySince = new Map<string, number>();
let unloadSweepInterval: NodeJS.Timeout | null = null;

/**
 * `connected` (не `onConnect`!) — фактическое успешное подключение уже
 * ПОСЛЕ onAuthenticate, а не попытка. Экспортирована (как и следующие две
 * функции) для юнит-тестов — тем же приёмом, что `isStaleEntry` в
 * `rooms/service.ts` (Э1.7): чистая функция от payload проверяется
 * напрямую, без похода через реальный Hocuspocus-хендшейк.
 */
export async function clearEmptySinceOnConnect(payload: Pick<connectedPayload, "documentName">): Promise<void> {
  emptySince.delete(payload.documentName);
}

export async function trackEmptySinceOnDisconnect(
  payload: Pick<onDisconnectPayload, "documentName" | "document">,
): Promise<void> {
  if (payload.document.getConnectionsCount() === 0) {
    emptySince.set(payload.documentName, Date.now());
  }
}

/**
 * Ветирует штатную попытку Hocuspocus выгрузить документ сразу после ухода
 * последнего участника (throw здесь безопасен — `unloadDocument()` в
 * `Hocuspocus.ts` оборачивает вызов этого хука в try/catch и просто молча
 * не выгружает документ при ошибке, без падения процесса). Если карта
 * `emptySince` почему-то не знает об этом документе (защитный случай — не
 * должно происходить в норме, раз `unloadDocument` сам вызывается только
 * при 0 подключений) — считаем, что грейс-период только начался, а не
 * пропускаем выгрузку: безопаснее по умолчанию подождать, чем случайно
 * выгрузить документ с недавней историей раньше времени.
 */
export async function vetoUnloadDuringGracePeriod(
  payload: Pick<beforeUnloadDocumentPayload, "documentName">,
): Promise<void> {
  const since = emptySince.get(payload.documentName);
  if (since === undefined) {
    emptySince.set(payload.documentName, Date.now());
    throw new Error("grace_period_just_started");
  }
  if (Date.now() - since < UNLOAD_GRACE_MS) {
    throw new Error("grace_period_not_elapsed");
  }
  emptySince.delete(payload.documentName);
}

/**
 * Ничто внутри Hocuspocus само не перепроверяет документ после того, как
 * `beforeUnloadDocument` его ветировал — единственные два места, откуда
 * вообще вызывается `unloadDocument()` (после `onStoreDocument` и при
 * закрытии последнего соединения), сами больше не сработают, если не
 * случится новая активность. Поэтому нужен собственный периодический
 * обход, тем же приёмом, что `startPresenceSweep()` в `rooms/service.ts`
 * (Э1.7) — иначе документ, у которого истёк грейс-период, но никто не
 * зашёл и не написал в него снова, повиснет в памяти навсегда.
 */
function sweepIdleCanvasDocuments(): void {
  const now = Date.now();
  for (const [documentName, since] of emptySince) {
    if (now - since < UNLOAD_GRACE_MS) continue;
    const document = hocuspocus.documents.get(documentName);
    if (!document || document.getConnectionsCount() > 0) {
      emptySince.delete(documentName);
      continue;
    }
    void hocuspocus.unloadDocument(document);
  }
}

export function startCanvasUnloadSweep(): void {
  if (unloadSweepInterval) return;
  unloadSweepInterval = setInterval(sweepIdleCanvasDocuments, UNLOAD_SWEEP_INTERVAL_MS);
  unloadSweepInterval.unref?.();
}

export function stopCanvasUnloadSweep(): void {
  if (unloadSweepInterval) {
    clearInterval(unloadSweepInterval);
    unloadSweepInterval = null;
  }
}

/** Для юнит-тестов sweep-цикла, без ожидания реального `setInterval`. */
export function runCanvasUnloadSweepOnce(): void {
  sweepIdleCanvasDocuments();
}

/** Количество Y.Doc, прямо сейчас находящихся в памяти процесса — метрика Prometheus (Э3.3). */
export function getActiveCanvasDocumentsCount(): number {
  return hocuspocus.documents.size;
}

/**
 * Единственный экземпляр Hocuspocus на процесс, монтируется в тот же
 * Fastify-сервер на `/collab` (см. canvas/ws.ts), не отдельным процессом —
 * жёсткое требование §3.4/§4.1.1 ТЗ.
 */
export const hocuspocus = new Hocuspocus({
  debounce: 3000,
  onAuthenticate: authenticateCanvasConnection,
  onLoadDocument: loadCanvasDocument,
  onStoreDocument: storeCanvasDocument,
  connected: clearEmptySinceOnConnect,
  onDisconnect: trackEmptySinceOnDisconnect,
  beforeUnloadDocument: vetoUnloadDuringGracePeriod,
});
