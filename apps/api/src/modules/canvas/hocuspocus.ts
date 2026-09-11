import {
  Hocuspocus,
  type afterUnloadDocumentPayload,
  type beforeUnloadDocumentPayload,
  type connectedPayload,
  type onAuthenticatePayload,
  type onDisconnectPayload,
  type onLoadDocumentPayload,
  type onStoreDocumentPayload,
} from "@hocuspocus/server";
import { randomInt, randomUUID } from "node:crypto";
import { generateKeyBetween } from "fractional-indexing";
import * as Y from "yjs";
import { encodeStateAsUpdate } from "yjs";
import { z } from "zod";
import { GUEST_CANVAS_TOKEN_MARKER } from "@school/shared";
import type { AccessTokenPayload, ParticipantKind } from "@school/shared";
import { AppError } from "../../plugins/errors.js";
import { verifyAccessToken } from "../auth/service.js";
import { GUEST_COOKIE_NAME, verifyGuestToken } from "../guests/service.js";
import { verifyRecorderToken } from "../recorder-auth/service.js";
import * as lessonsService from "../lessons/service.js";
import * as repo from "./repo.js";

const documentNameSchema = z.string().uuid();

/**
 * Э3.8, §5.2/§3.4 ТЗ: право рисовать — `canDraw`, тот же, что уже
 * используется в rooms/presence.ts (Э1.6). Здесь НЕ читаем/пишем presence
 * напрямую (canvas не должен зависеть от rooms — см. комментарий у
 * `authenticateCanvasConnection` ниже), а держим собственный in-memory
 * оверрайд наивного дефолта по роли, в который `rooms/service.ts`
 * ЯВНО пушит текущее значение при каждом изменении прав (тот же
 * односторонний поток «rooms → canvas», что уже установлен в Э3.2 для
 * `closeCanvasDocument`). Без явного пуша (типичный случай — свежий
 * коннект без единого изменения прав в этом уроке) используется тот же
 * дефолт по роли, что и в `presence.ts#defaultPermissions`: у
 * учителя/админа `canDraw: true`, у ученика — `false`.
 */
const drawPermissionOverrides = new Map<string, Map<string, boolean>>();

function computeCanDraw(kind: ParticipantKind, lessonId: string, participantId: string): boolean {
  const override = drawPermissionOverrides.get(lessonId)?.get(participantId);
  if (override !== undefined) return override;
  // Дефолт по роли, как в `presence.ts#defaultPermissions`: персонал рисует,
  // гость-ученик — нет, пока учитель не разрешил (живой пуш через `setDrawPermission`).
  return kind === "staff";
}

/**
 * Живой пуш текущего `canDraw` от `rooms/service.ts` (Э3.8) — вызывается
 * при каждом изменении прав, не только при подключении. Если у урока уже
 * есть открытое `/collab`-подключение этого участника, применяется
 * немедленно (`connection.readOnly` — обычное мутируемое публичное поле
 * `Connection`, проверено чтением `Connection.ts` пакета), без ожидания
 * переподключения — тот же принцип живого обновления уже выданного
 * гранта, что `mediaService.updateLivePermissions` для LiveKit (Э2.5).
 */
export function setDrawPermission(lessonId: string, userId: string, canDraw: boolean): void {
  let lessonOverrides = drawPermissionOverrides.get(lessonId);
  if (!lessonOverrides) {
    lessonOverrides = new Map();
    drawPermissionOverrides.set(lessonId, lessonOverrides);
  }
  lessonOverrides.set(userId, canDraw);

  const document = hocuspocus.documents.get(lessonId);
  if (!document) return;
  for (const connection of document.getConnections()) {
    if ((connection.context as { userId?: string } | undefined)?.userId === userId) {
      connection.readOnly = !canDraw;
    }
  }
}

/** Чистит оверрайды урока при выгрузке его документа — иначе карта растёт неограниченно на весь срок жизни процесса. */
export async function clearDrawPermissionOverrides(
  payload: Pick<afterUnloadDocumentPayload, "documentName">,
): Promise<void> {
  drawPermissionOverrides.delete(payload.documentName);
}

/**
 * Проверка «допущен ли персонал к уроку lessonId» — общая часть для двух
 * мест: подключения персонала к `/collab` (ниже) и HTTP-загрузки изображений
 * на доску (Э3.10, `assertCanDrawForLesson`).
 *
 * Логика прав ролей намеренно ДУБЛИРУЕТ rooms/service.ts#assertMembership, а
 * не переиспользует её: canvas не должен зависеть от rooms (это
 * presence/WS-модуль, а не владелец правил доступа к уроку), а правило
 * модульности CLAUDE.md запрещает модулю тянуть чужой repo.ts — здесь
 * используются только публичные сервисы lessons/users, как и в rooms.
 *
 * Э12.4: гость-ученик подключается к Y.Doc отдельным путём
 * (`resolveCanvasConnectionActor` ниже) — гостевой JWT сам по себе несёт
 * `lessonId`, дополнительная проверка членства не нужна.
 */
async function assertStaffLessonAccess(
  user: Pick<AccessTokenPayload, "sub" | "role" | "schoolId">,
  lessonId: string,
): Promise<void> {
  const lesson = await lessonsService.getLesson(user.schoolId, lessonId);

  if (user.role === "admin") return;
  if (user.role === "teacher") {
    if (lesson.teacherId !== user.sub) {
      throw new AppError(403, "forbidden", "Вы не ведёте этот урок");
    }
    return;
  }
  throw new AppError(403, "forbidden", "Роль не допускается к участию в уроке");
}

type CanvasConnectionActor =
  | { kind: ParticipantKind; participantId: string; role: string }
  // Э10.6 — recorder шаблона записи: read-only, никогда не участник урока
  // (не персонал, не гость), поэтому отдельный вариант союза, а не
  // ParticipantKind (тот пронизывает presence/аналитику — recorder туда не
  // должен попасть НИКАК, см. форс readOnly в authenticateCanvasConnection).
  | { kind: "recorder"; participantId: string; role: "recorder" };

/** Достаёт одну куку из заголовка `Cookie` без зависимости от Fastify-контекста (хук `onAuthenticate` вне request-жизненного цикла). */
function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) {
      return decodeURIComponent(pair.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/**
 * Э12.4 — кто подключается к холсту урока. Персонал: access-токен в
 * Yjs-параметре `token` + проверка допуска к уроку. Гость: гостевой JWT из
 * httpOnly-куки `guest_session` (`payload.requestHeaders.cookie`), `lessonId`
 * из токена обязан совпасть с документом. Читать построчно (CLAUDE.md
 * «работа с Y.Doc» + права доступа).
 */
async function resolveCanvasConnectionActor(
  token: string,
  requestHeaders: Headers | undefined,
  lessonId: string,
): Promise<CanvasConnectionActor> {
  // Э12.6: `HocuspocusProvider` не шлёт auth-сообщение при пустом токене, а
  // гостевой JWT лежит в httpOnly-куке (клиент его не читает). Поэтому гость
  // подключается с литералом-маркером `"guest"` в поле `token` — сам доступ
  // проверяется по куке ниже. Staff-токен — всегда JWT, с этим маркером не
  // совпадает.
  if (token && token !== GUEST_CANVAS_TOKEN_MARKER) {
    // Э10.6: recorder-токен — подписан своим секретом, staff-верификация его
    // просто отвергнет по подписи, поэтому пробуем recorder ПЕРВЫМ и без
    // побочных эффектов на неудаче (verifyRecorderToken возвращает null, не
    // бросает — см. docstring в recorder-auth/service.ts).
    const recorder = await verifyRecorderToken(token);
    if (recorder) {
      if (recorder.lessonId !== lessonId) {
        throw new AppError(403, "forbidden", "Recorder-токен относится к другому уроку");
      }
      return { kind: "recorder", participantId: `recorder:${recorder.recordingId}`, role: "recorder" };
    }

    const user = await verifyAccessToken(token);
    await assertStaffLessonAccess(user, lessonId);
    return { kind: "staff", participantId: user.sub, role: user.role };
  }

  const guestToken = readCookie(requestHeaders?.get("cookie"), GUEST_COOKIE_NAME);
  if (!guestToken) {
    throw new AppError(401, "missing_token", "Требуется вход в урок");
  }
  let guest;
  try {
    guest = await verifyGuestToken(guestToken);
  } catch {
    throw new AppError(401, "invalid_guest_session", "Гостевая сессия недействительна или истекла");
  }
  if (guest.lessonId !== lessonId) {
    throw new AppError(403, "forbidden", "Гостевая сессия относится к другому уроку");
  }
  return { kind: "guest", participantId: guest.guestId, role: "guest" };
}

/**
 * Проверяет права на lesson_id при подключении к Yjs-документу холста (Э3.1,
 * §3.4 ТЗ). documentName у Hocuspocus — это lessonId напрямую (`Y.Doc` один
 * на урок, отдельный namespace-префикс не нужен — коллизий имён документов
 * быть не может). С Э3.8 дополнительно выставляет `connectionConfig.readOnly`
 * по текущему `canDraw` — мутацией объекта payload напрямую, а не через
 * возвращаемое значение: подтверждено чтением `ClientConnection.ts`, что
 * именно `connectionConfig` (не результат хука) читается при создании
 * `Connection`; возвращаемое значение уходит только в `context`.
 */
export async function authenticateCanvasConnection(
  payload: Pick<
    onAuthenticatePayload,
    "token" | "documentName" | "connectionConfig" | "requestHeaders"
  >,
): Promise<{ userId: string; role: string }> {
  const parsedLessonId = documentNameSchema.safeParse(payload.documentName);
  if (!parsedLessonId.success) {
    throw new AppError(400, "invalid_document", "Некорректный идентификатор урока");
  }
  const lessonId = parsedLessonId.data;

  const actor = await resolveCanvasConnectionActor(payload.token, payload.requestHeaders, lessonId);
  // Recorder — всегда readOnly, в обход computeCanDraw (тот отвечает за
  // per-participant override рисования, к recorder'у неприменимо: он не
  // participantId в presence и никогда не должен рисовать).
  payload.connectionConfig.readOnly =
    actor.kind === "recorder" ? true : !computeCanDraw(actor.kind, lessonId, actor.participantId);
  return { userId: actor.participantId, role: actor.role };
}

/**
 * Э3.10: право загрузить изображение на доску урока — тот же гейт, что и
 * право рисовать (`canDraw`, Э3.8), не просто членство в уроке: вставка
 * картинки меняет содержимое холста так же, как штрих, и не должна быть
 * доступна ученику, у которого рисование сейчас выключено. Используется
 * HTTP-роутом `POST /lessons/:id/canvas-images` (canvas/routes.ts), где
 * `user` уже проверенный `request.user` от `app.authenticate` — токен здесь
 * не парсится повторно, в отличие от `authenticateCanvasConnection`.
 */
export async function assertCanDrawForLesson(
  user: Pick<AccessTokenPayload, "sub" | "role" | "schoolId">,
  lessonId: string,
): Promise<void> {
  await assertStaffLessonAccess(user, lessonId);
  if (!computeCanDraw("staff", lessonId, user.sub)) {
    throw new AppError(403, "forbidden", "Нет прав на рисование в этом уроке");
  }
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
  afterUnloadDocument: clearDrawPermissionOverrides,
});

// ─── Э8.10, §7.3 ТЗ: «вынести чей-то ответ на доску» ───────────────────────

type CanvasPageMeta = { order: number; backgroundAssetId: string | null; kind: string };

const BOARD_TEXT_FONT_SIZE = 20;
// Тот же множитель, что дефолт Excalidraw для шрифта Excalifont
// (FONT_METADATA пакета @excalidraw/excalidraw) — не читается динамически из
// пакета (это внутренняя таблица метрик шрифта, не публичный экспорт),
// поэтому зафиксирован числом здесь; расхождение меняет только приблизительную
// высоту текстового блока, не сам текст.
const BOARD_TEXT_LINE_HEIGHT = 1.25;
// Грубая оценка ширины символа для смеси кириллицы/латиницы при этом
// fontSize — см. докстринг buildAnswerTextElement про то, почему точный
// canvas measureText() здесь недоступен и не нужен.
const BOARD_TEXT_CHAR_WIDTH = BOARD_TEXT_FONT_SIZE * 0.55;
const BOARD_TEXT_MAX_LINE_CHARS = 48;

/**
 * Перенос строк по границам пробелов, не длиннее `maxChars` — упрощённый
 * аналог того, что Excalidraw обычно делает сам через `measureText()` в
 * браузере (недоступно в Node, см. `buildAnswerTextElement`). Слово длиннее
 * лимита не разбивается — для коротких ответов учеников не критично.
 */
function wrapPlainText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(" ")) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    lines.push(current);
  }
  return lines;
}

/**
 * Текстовый элемент Excalidraw для Y.Doc холста (Э8.10). Сервер не может
 * позвать НАСТОЯЩИЙ Excalidraw `newTextElement` — тот меряет текст через
 * браузерный canvas `measureText()`, недоступный в Node без тяжёлой
 * зависимости вроде `node-canvas` (не согласовывалась, § «Железные правила»
 * CLAUDE.md — без явного разрешения новых зависимостей не добавляем).
 * Ширина/высота ниже — приближение по числу символов и строк, НЕ точный
 * рендер-метрикс. `autoResize: true` — при первом редактировании ЛЮБЫМ
 * клиентом (двойной клик) Excalidraw перемеряет и сам поправит рамку; до
 * этого момента текст может слегка не совпадать с рамкой выделения — не
 * влияет на читаемость самого текста.
 *
 * Форма объекта — по `ExcalidrawTextElement` (`@excalidraw/excalidraw`,
 * версия пакета зафиксирована в apps/web/package.json). При апгрейде пакета
 * читать этот список полей построчно against установленный
 * `element/types.d.ts` — пропущенное обязательное поле здесь не бросит
 * ошибку (Excalidraw защищается дефолтами не для всех полей), а тихо даст
 * невидимый/сломанный элемент — тот же класс бага, что и весь раздел
 * «работа с Y.Doc» CLAUDE.md.
 */
function buildAnswerTextElement(text: string, origin: { x: number; y: number }) {
  const lines = wrapPlainText(text, BOARD_TEXT_MAX_LINE_CHARS);
  const longestLine = Math.max(1, ...lines.map((l) => l.length));
  const width = Math.round(longestLine * BOARD_TEXT_CHAR_WIDTH);
  const height = Math.round(lines.length * BOARD_TEXT_FONT_SIZE * BOARD_TEXT_LINE_HEIGHT);
  const joined = lines.join("\n");
  const now = Date.now();
  return {
    id: randomUUID(),
    type: "text",
    x: origin.x,
    y: origin.y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roundness: null,
    roughness: 1,
    opacity: 100,
    seed: randomInt(1, 2 ** 31),
    version: 1,
    versionNonce: randomInt(1, 2 ** 31),
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
    text: joined,
    fontSize: BOARD_TEXT_FONT_SIZE,
    fontFamily: 5, // FONT_FAMILY.Excalifont — дефолт Excalidraw, id зафиксирован у пакета
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    originalText: joined,
    autoResize: true,
    lineHeight: BOARD_TEXT_LINE_HEIGHT,
  };
}

/**
 * Учитель «выносит ответ на доску» (Э8.10, §7.3 ТЗ) — дописывает текстовый
 * элемент в `Y.Array` активной страницы холста урока СЕРВЕРНОЙ транзакцией,
 * без похода через клиентский `ExcalidrawBinding` (кто жмёт кнопку разбора,
 * не обязан держать открытой саму доску).
 *
 * `openDirectConnection` — официальный API Hocuspocus для записи в документ
 * вне обычного WS-подключения (проверено чтением исходника пакета:
 * `DirectConnection`, `packages/server/src/DirectConnection.ts`). Он
 * переиспользует ТОТ ЖЕ `Document` в памяти, что и у реальных участников
 * (`Hocuspocus#createDocument` отдаёт уже закэшированный документ по имени,
 * если он есть) — правки видны им сразу, без перезагрузки; если сейчас
 * никто не подключён, тот же вызов сам поднимет документ из Postgres
 * (`loadCanvasDocument`, `onAuthenticate` при этом НЕ вызывается —
 * `openDirectConnection` идёт в обход хендшейка, `isAuthenticated: true`
 * зашито в сам вызов создателем документа).
 *
 * `disconnect()` без аргументов — `unloadImmediately: true` по умолчанию
 * (проверено чтением `DirectConnection.ts`) — форсирует немедленный
 * `onStoreDocument` (сохранение в Postgres), не дожидаясь обычного
 * 3-секундного дебаунса: пуш ответа на доску — редкое разовое действие
 * учителя, а не поток правок, задержка сохранения здесь не нужна.
 */
export async function postAnswerToBoard(lessonId: string, text: string): Promise<void> {
  const connection = await hocuspocus.openDirectConnection(lessonId);
  try {
    await connection.transact((document) => {
      const metaMap = document.getMap<unknown>("meta");
      const pagesMap = document.getMap<CanvasPageMeta>("pages");
      let pageId = metaMap.get("activePageId") as string | undefined;
      if (!pageId || !pagesMap.has(pageId)) {
        // Защитный случай — урок ни разу не открывал доску (Board.tsx сам
        // заводит первую страницу при первом подключении, Э3.4). Заводим
        // страницу здесь же, чтобы разбор не падал из-за того, что никто
        // ещё не смотрел на холст.
        pageId = randomUUID();
        pagesMap.set(pageId, { order: 0, backgroundAssetId: null, kind: "blank" });
        metaMap.set("activePageId", pageId);
      }
      const yElements = document.getArray<Y.Map<unknown>>(`elements:${pageId}`);
      const lastPos =
        yElements.length > 0 ? (yElements.get(yElements.length - 1).get("pos") as string) : null;
      const pos = generateKeyBetween(lastPos, null);
      // Небольшой случайный разброс координат — чтобы несколько ответов,
      // вынесенных подряд, не легли ровно друг на друга; учитель раздвигает
      // вручную, автолэйаута здесь нет.
      const origin = { x: 100 + randomInt(0, 300), y: 100 + randomInt(0, 300) };
      const element = buildAnswerTextElement(text, origin);
      yElements.push([new Y.Map(Object.entries({ pos, el: element }))]);
    });
  } finally {
    await connection.disconnect();
  }
}
