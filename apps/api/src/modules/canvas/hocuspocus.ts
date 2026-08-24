import {
  Hocuspocus,
  type onAuthenticatePayload,
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

/**
 * Единственный экземпляр Hocuspocus на процесс, монтируется в тот же
 * Fastify-сервер на `/collab` (см. canvas/ws.ts), не отдельным процессом —
 * жёсткое требование §3.4/§4.1.1 ТЗ.
 *
 * `unloadImmediately` намеренно оставлен на значении по умолчанию
 * (`true`) — выгрузка документа из памяти сразу после ухода последнего
 * участника. Кастомный 5-минутный grace-период на переподключение (Э3.3
 * плана) сюда ещё не добавлен — это отдельная задача, трогать её сейчас
 * значило бы смешивать Э3.2 и Э3.3 в одном коммите.
 */
export const hocuspocus = new Hocuspocus({
  debounce: 3000,
  onAuthenticate: authenticateCanvasConnection,
  onLoadDocument: loadCanvasDocument,
  onStoreDocument: storeCanvasDocument,
});
