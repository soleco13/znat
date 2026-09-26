import { useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, NormalizedZoomValue } from "@excalidraw/excalidraw/types";
import type { BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";
import type { FileId, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { ExcalidrawBinding } from "y-excalidraw";
import * as Y from "yjs";
import {
  ImagePlus,
  MoreHorizontal,
  Navigation,
  Plus,
  Presentation,
  Redo2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { CANVAS_IMAGE_MAX_BYTES, GUEST_CANVAS_TOKEN_MARKER } from "@school/shared";
import type { CanvasImageUploadResponse, Deck } from "@school/shared";

import { cn } from "@/lib/utils";
import { useAuthStore } from "@/shared/auth-store";
import { useGuestSessionStore } from "@/features/guest/guest-session-store";
import { apiFetch, getFreshAccessToken } from "@/shared/api-client";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Separator } from "@/shared/ui/separator";
import { SimpleTooltip } from "@/shared/ui/tooltip";
import {
  BACKGROUND_KIND_LABELS,
  PageBackground,
  SlideThumb,
  type BackgroundKind,
  type SlidePageRef,
} from "./PageBackground.js";
import { getPdfPageSizes } from "./pdf.js";
import { MobileToolRail, type RailTool } from "./MobileToolRail.js";
import { SlideSearch } from "./SlideSearch.js";
import { createCoalescingApi, paceUpstream, throttleWhen, useBoardLinkPoor } from "./board-link.js";
import "@excalidraw/excalidraw/index.css";
import "./Board.css";

/** Наибольшая сторона изображения при первой вставке на холст (мировые
 *  единицы, не зависят от zoom) — сервер уже прислал ресайз до 2000px
 *  (Э3.10), это отдельное ограничение под удобный начальный размер на
 *  экране; дальше учитель/ученик масштабирует вручную как обычный элемент. */
const PLACED_IMAGE_MAX_SIDE = 480;

/** Разрешённые для загрузки на доску типы (Э3.10, §3.3 ТЗ) — зеркалит `canvasImageMimeTypeSchema` из packages/shared. */
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Э3.12, §3.4 ТЗ: «максимум 500 элементов на страницу, предупреждение при
 * приближении. Доска не деградирует». Это перформанс-ограничитель, не
 * граница доступа — enforcement клиентский (у всех клиентов одинаковый, а
 * рисование и так под `canDraw`); при достижении лимита локальные новые
 * элементы откатываются, удаление/правка существующих остаются доступны,
 * чтобы можно было разгрузить страницу.
 */
const PAGE_ELEMENT_LIMIT = 500;
const PAGE_ELEMENT_WARN_AT = 450;

/**
 * Э12.7 — фиксированный id первой страницы доски. Если два клиента откроют
 * ещё пустой холст одновременно, оба вызовут `pagesMap.set(FIRST_PAGE_ID, …)`
 * — Yjs сольёт их в ОДНУ запись (та же ключевая строка), а не создаст две
 * копии листа. Инициализация к тому же отложена до синхронизации с сервером
 * (см. эффект ниже), так что в норме гонки нет вовсе.
 */
const FIRST_PAGE_ID = "board-page-1";
/** §6.5: не больше 3 листов доски (слайды презентации — отдельно, не в счёт). */
const MAX_BOARD_PAGES = 3;
/** Сколько правки могут ждать подтверждения сервера без единого ack, прежде чем считаем синхронизацию сломанной. */
const SYNC_STALL_MS = 5000;

/** Стабильный цвет курсора участника — из userId, без похода на сервер (Э3.9). */
function cursorColorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 70%, 45%)`;
}

type ViewportAwarenessState = {
  scrollX: number;
  scrollY: number;
  zoom: number;
  /** CSS px контейнера холста источника — нужны получателю, чтобы пересчитать
   * scroll под СВОЙ размер контейнера (см. `centerScrollFor` ниже). */
  containerWidth: number;
  containerHeight: number;
};

/**
 * Пересчёт чужого viewport'а под СВОЙ контейнер: показать ту же область
 * сцены, что видит источник, целиком и по центру.
 *
 * Почему нельзя просто скопировать `scrollX/scrollY/zoom` (так было, и это
 * дважды ловил пользователь как «доска обрезана», 2026-09-11): `zoom` —
 * это масштаб «сцена → CSS-пиксели», а видимая область = размер контейнера
 * / zoom. Контейнеры не совпадают и совпасть не могут: у автора доски —
 * его окно браузера (замерено вживую: 2338×1162), у записи — кадр 1280×720
 * минус лента камер (~1068×696). При одинаковом `zoom` вдвое меньший
 * контейнер физически показывает вдвое меньше сцены — всё, что не влезло,
 * обрезается по краям.
 *
 * Поэтому zoom масштабируем на отношение размеров (`min` по осям — чтобы
 * область источника поместилась целиком, а не обрезалась по узкой оси), а
 * центр совмещаем: `screenX = (sceneX + scrollX) * zoom` ⇒
 * `sceneX = screenX / zoom - scrollX` (тот же приём, что ниже по файлу для
 * центрирования новых фигур). Зум/позиция при этом остаются ЖИВЫМИ: автор
 * зумит или панорамирует — пересчёт едет за ним.
 */
function centerScrollFor(
  viewport: ViewportAwarenessState,
  ownWidth: number,
  ownHeight: number,
): { scrollX: number; scrollY: number; zoom: number } {
  const { scrollX, scrollY, zoom, containerWidth, containerHeight } = viewport;
  if (!containerWidth || !containerHeight || !ownWidth || !ownHeight) {
    return { scrollX, scrollY, zoom };
  }
  const fitZoom = clampZoom(zoom * Math.min(ownWidth / containerWidth, ownHeight / containerHeight));
  const centerSceneX = containerWidth / 2 / zoom - scrollX;
  const centerSceneY = containerHeight / 2 / zoom - scrollY;
  return {
    scrollX: ownWidth / 2 / fitZoom - centerSceneX,
    scrollY: ownHeight / 2 / fitZoom - centerSceneY,
    zoom: fitZoom,
  };
}

/** Диапазон зума самого Excalidraw — за его пределами `updateScene` молча не применится. */
function clampZoom(value: number): number {
  return Math.min(30, Math.max(0.1, value));
}
type UserAwarenessState = { id: string; name: string; color: string; role: string };

/**
 * Метаданные страницы холста (Э3.6/Э3.7, §3.4/§4.3 ТЗ:
 * `Y.Map "pages"` → `pageId → { backgroundAssetId, order, kind }`).
 * `backgroundAssetId` (фон-изображение, загруженное вручную) остаётся
 * зарезервированным полем без своего UI. `slide` (Э4.6) заполняется при
 * импорте презентации: страница с `kind: "image"` показывает отрендеренный
 * слайд как фон, поверх которого можно рисовать.
 */
type PageMeta = {
  order: number;
  backgroundAssetId: string | null;
  kind: BackgroundKind;
  slide?: SlidePageRef | null;
};

function sortedPageEntries(pagesMap: Y.Map<PageMeta>): Array<[string, PageMeta]> {
  return [...pagesMap.entries()].sort((a, b) => a[1].order - b[1].order);
}

/**
 * Доска урока (Э3.4–Э3.6, §3.4/§4.3 ТЗ). Один общий `Y.Doc` на урок, с
 * Э3.6 — бесконечная лента страниц: элементы каждой страницы лежат в
 * СВОЁМ `Y.Array "elements:{pageId}"` (было единое `"elements"` без
 * разбивки в Э3.5 — миграции нет и не нужно, реальных уроков в БД ещё
 * не существует, проект ещё не запущен).
 *
 * Жизненный цикл разделён на три независимых `useEffect`, каждый со
 * своей парой create/destroy (область Y.Doc — «не делегировать вслепую»
 * CLAUDE.md, ошибка здесь означает утечку сети/памяти на каждом
 * переключении страницы или перерендере):
 * 1. Подключение (`Y.Doc` + `HocuspocusProvider`) — зависит только от
 *    `lessonId` и наличия токена, не пересоздаётся при листании страниц.
 * 2. Синхронизация списка страниц и `activePageId` из `Y.Map`ов
 *    `"pages"`/`"meta"` — зависит от `ydoc` (готовности подключения №1).
 * 3. `ExcalidrawBinding` — привязывается к `Y.Array` ИМЕННО активной
 *    страницы, пересоздаётся при каждой смене `activePageId` (у
 *    `y-excalidraw` одна привязка = один массив элементов = одна сцена,
 *    отдельного API «переключить сцену на лету» у пакета нет — смена
 *    страницы технически и есть destroy+create новой привязки).
 *
 * `canDraw` (Э3.8, §5.2 ТЗ) переключает Excalidraw в `viewModeEnabled` —
 * это UX-слой, не единственная защита: авторитетное решение уже принято
 * сервером на уровне `connectionConfig.readOnly` в `canvas/hocuspocus.ts`
 * (Yjs-обновления от read-only подключения молча отбрасываются вне
 * зависимости от того, что показывает клиентский UI).
 *
 * Э3.9 добавляет курсоры (через `awareness` + `binding.onPointerUpdate`,
 * см. проп `onPointerUpdate` у `<Excalidraw>`) и «следовать за учителем»
 * (свой awareness-канал `viewport`, отдельный от того, что использует сам
 * `y-excalidraw`).
 */
export function Board({
  lessonId,
  canDraw,
  decks = [],
  onClose,
  connectionToken,
  readOnlyChrome = false,
  followUserId,
}: {
  lessonId: string;
  canDraw: boolean;
  /** Э4.6: готовые презентации урока — учитель импортирует их слайды как страницы. */
  decks?: Deck[];
  /** Э12.7 §6.5: «Скрыть доску» в шапке доски (у учителя) — возврат к плиткам. */
  onClose?: () => void;
  /**
   * Э10.6 — шаблон записи (`/egress`) вне `RequireAuth`: там нет ни
   * `useAuthStore`, ни гостевой сессии, подключаться нечем. Recorder-токен
   * приходит извне и идёт в Hocuspocus вместо access-токена/гостевого
   * маркера. Для обычного урока не передаётся — поведение не меняется.
   */
  connectionToken?: string;
  /**
   * Э10.6 — шаблон записи: без панели страниц/меню «Ещё»/кнопки «Скрыть
   * доску» (recorder ни с чем из этого не взаимодействует, а в кадр записи
   * чужая UI-хром попадать не должна). Сам Excalidraw уже read-only через
   * `canDraw={false}` → `viewModeEnabled`; это только про наш тулбар поверх.
   */
  readOnlyChrome?: boolean;
  /**
   * Доработка после теста записи (2026-09-11): recorder следует за
   * viewport'ом КОНКРЕТНО того, кто запустил запись (`userId`, передан
   * через `startLessonRecording` → `templateQuery.followUserId` →
   * `EgressPage.tsx`), а не за первым встречным с `role === "teacher"` —
   * инициатор мог быть admin, и матчинг по роли тогда молча не находил
   * никого. Для обычного «следовать за учителем» (кнопка в тулбаре
   * ученика) не передаётся — там матчинг по роли, как и был.
   */
  followUserId?: string;
}) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  // Для MobileToolRail (телефон/планшет, §см. Board.css `.App-toolbar--mobile`) —
  // какой инструмент активен сейчас, чтобы подсвечивать нужную кнопку.
  // Источник истины один: `AppState.activeTool` самого Excalidraw, синка —
  // через `onChange` (он же используется для лимита элементов страницы).
  const [railActiveTool, setRailActiveTool] = useState<RailTool>("selection");
  const [railLocked, setRailLocked] = useState(false);
  const hasAccessToken = useAuthStore((s) => !!s.accessToken);
  const me = useAuthStore((s) => s.user);
  const guestSession = useGuestSessionStore((s) => s.session);
  const isGuest = !me && !!guestSession;
  const role = me?.role;
  const isTeacher = role === "teacher" || role === "admin";
  const [followTeacher, setFollowTeacher] = useState(false);
  const boardContainerRef = useRef<HTMLDivElement>(null);
  // Обёртка непосредственно вокруг <Excalidraw> — нужна `y-excalidraw` для
  // перехвата Ctrl+Z/Ctrl+Shift+Z (capture-слушатель keydown) и для поиска
  // кнопок «Undo»/«Redo» в тулбаре по `[aria-label]` (Э3.11).
  const excalidrawWrapperRef = useRef<HTMLDivElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Э4.6: выбранная в селекторе презентация для импорта + короткая заметка.
  const [importDeckId, setImportDeckId] = useState<string>("");
  const [importNote, setImportNote] = useState<string | null>(null);

  // Храним `provider`, а не голый `Y.Doc` — `ExcalidrawBinding` реально
  // требует живой `Awareness` (см. комментарий у binding-эффекта ниже), а
  // `provider.awareness` создаётся и живёт вместе с провайдером. `Y.Doc`
  // при этом создаём и уничтожаем САМИ явно, а не полагаемся на
  // провайдер: `HocuspocusProvider.destroy()` **не** вызывает
  // `document.destroy()`, даже для документа, который он сам же создал
  // бы по умолчанию (не передай мы `document` в конфиг) — проверено
  // чтением исходника `HocuspocusProvider.ts#destroy()`. Раз ответственность
  // за уничтожение документа провайдер на себя не берёт ни в каком случае,
  // документ должен создаваться и уничтожаться на нашей стороне явно.
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [pages, setPages] = useState<Array<[string, PageMeta]>>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const ydoc = provider?.document ?? null;

  // Слабая связь у ЭТОГО участника — доска переходит в экономный режим
  // (см. board-link.ts). Объявлено до эффекта создания провайдера: при
  // размонтировании React снимает эффекты по порядку, и штатная отправка
  // возвращается провайдеру раньше, чем он уничтожается.
  const linkPoor = useBoardLinkPoor(provider);
  const linkPoorRef = useRef(false);
  useEffect(() => {
    linkPoorRef.current = linkPoor;
  }, [linkPoor]);
  useEffect(() => {
    if (!provider || !linkPoor) return;
    return paceUpstream(provider);
  }, [provider, linkPoor]);

  useEffect(() => {
    // Э12.6: персонал подключается с access-токеном; гость-ученик — с
    // литералом-маркером (`HocuspocusProvider` не шлёт auth-сообщение при
    // пустом токене), доступ проверяется по httpOnly-куке `guest_session`
    // в `canvas/hocuspocus.ts#resolveCanvasConnectionActor`.
    // Персонал — функцией: провайдер зовёт её на каждом (пере)подключении, и
    // после обрыва или перезапуска сервера уходит свежий токен, а не истёкший
    // из памяти. Поэтому и зависимость эффекта — наличие токена, а не его
    // значение: плановое обновление токена больше не пересоздаёт Y.Doc посреди урока.
    const token =
      connectionToken ??
      (hasAccessToken
        ? async () => (await getFreshAccessToken()) ?? ""
        : isGuest
          ? GUEST_CANVAS_TOKEN_MARKER
          : null);
    if (!token) return;

    const doc = new Y.Doc();
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const nextProvider = new HocuspocusProvider({
      url: `${protocol}//${location.host}/collab`,
      name: lessonId,
      document: doc,
      token,
    });
    setProvider(nextProvider);

    return () => {
      setProvider(null);
      setPages([]);
      setActivePageId(null);
      nextProvider.destroy();
      doc.destroy();
    };
  }, [lessonId, hasAccessToken, isGuest, connectionToken]);

  // Пока клиент read-only, y-excalidraw всё равно пишет в Y.Doc (например,
  // зеркалит загруженные картинки в `assets`), и сервер эти правки отбрасывает.
  // После выдачи права Yjs держит все следующие правки клиента в pending — им
  // не хватает отброшенного начала, — и до учителя ничего не доходит. Повторный
  // SyncStep1 заставляет сервер запросить у клиента всё недостающее, дыра
  // закрывается (проверено на живом Hocuspocus 4.6).
  useEffect(() => {
    if (canDraw && provider?.isSynced) provider.forceSync();
  }, [provider, canDraw]);

  // Сторож синхронизации: правки ждут подтверждения, а подтверждений нет
  // `SYNC_STALL_MS` подряд (сервер отбрасывает их или сокет умер без close,
  // как бывает на мобильной сети) — молча повторяем SyncStep1, пока не
  // пройдёт. Надписи ученику не показываем: на уроке она только отвлекает.
  useEffect(() => {
    // Без права рисовать сервер отбрасывает любую локальную правку, ждать
    // подтверждения нечего.
    if (!provider || !canDraw) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = provider.unsyncedChanges;
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const arm = () => {
      stop();
      timer = setTimeout(() => {
        timer = null;
        provider.forceSync();
      }, SYNC_STALL_MS);
    };
    const onUnsyncedChanges = ({ number }: { number: number }) => {
      if (number === 0) {
        stop();
      } else if (number < last || !timer) {
        arm();
      }
      last = number;
    };
    provider.on("unsyncedChanges", onUnsyncedChanges);
    return () => {
      stop();
      provider.off("unsyncedChanges", onUnsyncedChanges);
    };
  }, [provider, canDraw]);

  useEffect(() => {
    if (!ydoc || !provider) return;
    const pagesMap = ydoc.getMap<PageMeta>("pages");
    const metaMap = ydoc.getMap<unknown>("meta");

    const syncPages = () => setPages(sortedPageEntries(pagesMap));
    // Активная страница: если её id пропал из `pagesMap` (пришла
    // синхронизация с сервером и локально созданная временная страница
    // затёрлась, или лист удалили) — показываем первую существующую, а не
    // пустоту. Именно это чинит «ученик не видит лист учителя».
    const syncActivePage = () => {
      const id = metaMap.get("activePageId") as string | undefined;
      if (id && pagesMap.has(id)) setActivePageId(id);
      else setActivePageId(sortedPageEntries(pagesMap)[0]?.[0] ?? null);
    };

    // Первую страницу создаём ТОЛЬКО после синхронизации с сервером: до неё
    // локально пустой (ещё не загруженный) документ выглядит как «страниц
    // нет», и каждый вошедший плодил бы свою копию листа. Фиксированный
    // `FIRST_PAGE_ID` — страховка от остаточной гонки.
    let initialized = false;
    const initFirstPage = () => {
      if (initialized) return;
      initialized = true;
      ydoc.transact(() => {
        if (pagesMap.size === 0) {
          pagesMap.set(FIRST_PAGE_ID, { order: 0, backgroundAssetId: null, kind: "blank" });
        }
        const active = metaMap.get("activePageId") as string | undefined;
        if (!active || !pagesMap.has(active)) {
          metaMap.set("activePageId", sortedPageEntries(pagesMap)[0]![0]);
        }
      });
      syncPages();
      syncActivePage();
    };

    if (provider.isSynced) initFirstPage();
    else provider.on("synced", initFirstPage);

    syncPages();
    syncActivePage();
    pagesMap.observe(syncPages);
    pagesMap.observe(syncActivePage);
    metaMap.observe(syncActivePage);
    return () => {
      provider.off("synced", initFirstPage);
      pagesMap.unobserve(syncPages);
      pagesMap.unobserve(syncActivePage);
      metaMap.unobserve(syncActivePage);
    };
  }, [ydoc, provider]);

  // Экземпляр привязки в состоянии (не только внутри эффекта) — нужен
  // снаружи, чтобы прокинуть `binding.onPointerUpdate` в проп `<Excalidraw
  // onPointerUpdate>` (Э3.9, курсоры собеседников: см. эффект ниже).
  const [binding, setBinding] = useState<ExcalidrawBinding | null>(null);
  // Свой курсор при слабой связи — не чаще раза в 100 мс (последнее положение).
  const pointerUpdate = useMemo(
    () => (binding ? throttleWhen(binding.onPointerUpdate, () => linkPoorRef.current) : undefined),
    [binding],
  );

  // Э3.11: `Y.UndoManager` активной страницы + его текущее состояние для
  // наших кнопок Undo/Redo (штатные кнопки Excalidraw спрятаны — см. ниже).
  const [undoState, setUndoState] = useState<{
    manager: Y.UndoManager;
    canUndo: boolean;
    canRedo: boolean;
  } | null>(null);

  // Э3.12: число элементов активной страницы (из её `Y.Array`) — источник
  // истины для предупреждения и отката. `revertingRef` гасит рекурсию
  // `onChange` → `updateScene` → `onChange` при обрезке.
  const [pageElementCount, setPageElementCount] = useState(0);
  const revertingRef = useRef(false);

  useEffect(() => {
    if (!excalidrawAPI || !ydoc || !provider?.awareness || !activePageId) return;
    const yElements = ydoc.getArray<Y.Map<unknown>>(`elements:${activePageId}`);
    const yAssets = ydoc.getMap<unknown>("assets");

    // Защита от повреждённых записей: если запись `Y.Map` осталась без
    // ключа `el` (замечено на реальном уроке — клиент прервался между
    // добавлением `pos` и самого элемента, писавшего их не одной
    // Y-транзакцией; точный триггер внутри `y-excalidraw` не установлен, но
    // сам паттерн повторяем), безусловное `x.get("el").id` внутри
    // `ExcalidrawBinding` (`y-excalidraw`, не наш код) падает — И в
    // конструкторе (роняет ErrorBoundary всей страницы урока, не только
    // доску — пользователь не мог войти), И в его собственном обработчике
    // чужих правок `_remoteElementsChangeHandler` (тихо валит именно
    // ПРИМЕНЕНИЕ локальной правки ДО отправки в `yElements` — отсюда «с
    // одного клиента рисую, у других не появляется»).
    //
    // Разовой чистки при монтировании (было раньше) достаточно только на
    // открытии уже испорченной доски. Чтобы порча не долетела до чужого
    // клиента, ПОКА доска у него уже открыта, нужен постоянный наблюдатель:
    // регистрируем его ДО создания `ExcalidrawBinding` — `y-excalidraw`
    // вешает СВОЙ `observeDeep` внутри своего конструктора (ниже), то есть
    // ПОСЛЕ нашего `.observe()`. Yjs вызывает наблюдателей одного и того же
    // массива в порядке регистрации, а наша чистка внутри `ydoc.transact`
    // применяется синхронно — к моменту, когда очередь дойдёт до
    // обработчика `y-excalidraw` для того же события, битой записи в
    // `yElements` уже нет. Сам вызов `sanitize()` из своего же `.observe()`
    // не зацикливается: после удаления повторный проход находит 0 битых
    // записей и не трогает документ.
    const sanitize = () => {
      const corruptIndexes: number[] = [];
      yElements.forEach((entry, i) => {
        if (!entry.get("el")) corruptIndexes.push(i);
      });
      if (corruptIndexes.length === 0) return;
      ydoc.transact(() => {
        for (let i = corruptIndexes.length - 1; i >= 0; i--) {
          yElements.delete(corruptIndexes[i]!, 1);
        }
      });
    };
    sanitize();
    yElements.observe(sanitize);

    // Э3.11, §3.4 ТЗ: undo/redo в мультиплеере через `Y.UndoManager` со
    // scope по клиенту. Scope — `Y.Array` ИМЕННО активной страницы (у
    // каждой страницы свой массив с Э3.6), поэтому менеджер живёт и
    // умирает вместе с привязкой, пересоздаётся при листании.
    //
    // «Scope по клиенту» получается сам: `trackedOrigins: new Set()`
    // (пусто) + `y-excalidraw` внутри `setupUndoRedo` добавляет саму
    // привязку через `undoManager.addTrackedOrigin(binding)`. Локальные
    // правки этого клиента применяются к `yElements` с origin === привязка
    // (проверено чтением бандла `y-excalidraw`: `applyElementOperations(...,
    // this)`), а удалённые правки `HocuspocusProvider` применяет с
    // origin === сам провайдер (проверено чтением бандла провайдера:
    // `readSyncMessage(decoder, encoder, provider.document, provider)` —
    // 4-й аргумент это `transactionOrigin`). Значит менеджер захватывает
    // ровно свои изменения и никогда — чужие: Ctrl+Z не откатывает работу
    // соседа.
    //
    // `undoConfig` заводится только при `canDraw`: в `viewModeEnabled`
    // (ученик без права рисовать, Э3.8) само рисование недоступно, undo не
    // нужен. `excalidrawDom` — обёртка вокруг <Excalidraw>: `y-excalidraw`
    // вешает на неё capture-слушатель keydown (Ctrl+Z/Ctrl+Shift+Z) и
    // `stopPropagation`, чтобы родная история Excalidraw не конфликтовала с
    // `Y.UndoManager`. `canDraw` в зависимостях эффекта — смена права
    // пересоздаёт привязку.
    const undoConfig =
      canDraw && excalidrawWrapperRef.current
        ? {
            excalidrawDom: excalidrawWrapperRef.current,
            undoManager: new Y.UndoManager(yElements, { trackedOrigins: new Set<unknown>() }),
          }
        : undefined;

    // `awareness` формально помечен опциональным в типах `y-excalidraw`, но
    // это не так на практике: без него конструктор падает с
    // `TypeError: Cannot read properties of undefined (reading 'getStates')`
    // на безусловном (не под `if (this.awareness)`) обращении в конце
    // конструктора — поймано живой проверкой в браузере (Playwright), не
    // по докам/типам пакета.
    // При слабой связи входящие правки и курсоры перерисовываются раз в кадр.
    // Обёртка живёт вместе с привязкой; режим читается на каждом вызове, так
    // что смена режима не пересоздаёт привязку (и не теряет историю undo).
    const coalescing = createCoalescingApi(excalidrawAPI, () => linkPoorRef.current);
    const nextBinding = new ExcalidrawBinding(
      yElements,
      yAssets,
      coalescing.api,
      provider.awareness,
      undoConfig,
    );
    // Конструктор привязки заливает все ассеты документа в Excalidraw
    // (`addFiles`), но `lastKnownFileIds` оставляет пустым — первый же
    // `onChange` считает их «новыми» и пишет обратно в `yAssets`. У
    // read-only ученика сервер отбрасывает эту правку, `unsyncedChanges`
    // не падает до нуля, и через `SYNC_STALL_MS` вылезает «Доска не
    // синхронизирована» сразу после входа (если на доске есть картинки).
    // Рисующим это лишний перезапис каждого ассета при каждом входе.
    nextBinding.lastKnownFileIds = new Set(yAssets.keys());
    setBinding(nextBinding);

    // Штатные кнопки Undo/Redo Excalidraw `y-excalidraw` перехватывает по
    // клику, но их доступность (`disabled`) остаётся завязана на РОДНУЮ
    // историю Excalidraw, а не на `Y.UndoManager` — из-за `stopPropagation`
    // в его же keydown-хендлере родной redo-стек никогда не наполняется, и
    // кнопка Redo всегда серая (поймано живой проверкой). Поэтому штатные
    // кнопки спрятаны (Board.css), а рисуем свои — от состояния менеджера.
    const undoManager = undoConfig?.undoManager ?? null;
    if (undoManager) {
      const syncUndo = () =>
        setUndoState({ manager: undoManager, canUndo: undoManager.canUndo(), canRedo: undoManager.canRedo() });
      syncUndo();
      undoManager.on("stack-item-added", syncUndo);
      undoManager.on("stack-item-popped", syncUndo);
      undoManager.on("stack-item-updated", syncUndo);
    }

    return () => {
      setBinding(null);
      setUndoState(null);
      yElements.unobserve(sanitize);
      nextBinding.destroy();
      coalescing.dispose();
      // `nextBinding.destroy()` только снимает свои подписи/слушатели
      // (проверено чтением бандла — прогоняет `this.subscriptions`), но
      // НЕ трогает переданный `Y.UndoManager`. Уничтожаем сами — это же
      // снимает все три подписки `stack-item-*` выше.
      undoManager?.destroy();
    };
  }, [excalidrawAPI, ydoc, provider, activePageId, canDraw]);

  /**
   * Э3.12: следим за числом элементов активной страницы прямо по её
   * `Y.Array` (а не по сцене Excalidraw) — это то же число у всех
   * участников, независимо от локального состояния рендера.
   */
  useEffect(() => {
    if (!ydoc || !activePageId) return;
    const yElements = ydoc.getArray(`elements:${activePageId}`);
    const sync = () => setPageElementCount(yElements.length);
    sync();
    yElements.observe(sync);
    return () => yElements.unobserve(sync);
  }, [ydoc, activePageId]);

  /**
   * Э3.9, §3.4 ТЗ: awareness → курсоры собеседников. `y-excalidraw` сам
   * строит `Collaborator`-ов из `state.user?.name`/`color` (см. заметку в
   * Э3.5/Э3.8 про безусловный `getStates()`), но не публикует его САМ —
   * локальное поле `user` в awareness должны выставить мы, иначе
   * собеседники увидят анонимный курсор без имени/цвета.
   */
  useEffect(() => {
    if (!provider?.awareness || !me) return;
    const userState: UserAwarenessState = { id: me.id, name: me.fullName, color: cursorColorFor(me.id), role: me.role };
    provider.awareness.setLocalStateField("user", userState);
  }, [provider, me]);

  /**
   * Мобильная/планшетная адаптация (жалоба пользователя, 2026-09-12): на
   * телефоне/планшете доска после поворота экрана или открытия/закрытия
   * клавиатуры оставалась «заземлена» — Excalidraw не перерисовывался под
   * новый размер контейнера, и содержимое выглядело обрезанным. У
   * Excalidraw есть собственный ResizeObserver на свой контейнер, но он
   * реагирует на реальное изменение РАЗМЕРА бокса; на iOS/Android при
   * появлении клавиатуры или повороте (особенно вместе с нашим `overflow-
   * y-auto` на `<main>` в RoomPage) браузер не всегда шлёт то самое
   * событие, на которое Excalidraw подписан, и его внутренний кеш
   * `document.getBoundingClientRect()` устаревает. Публичный метод
   * `excalidrawAPI.refresh()` для этого и существует (см. типы пакета —
   * "Recalculates the position of the excalidraw component on screen") —
   * дергаем его сами по `ResizeObserver` на НАШЕМ контейнере (более
   * надёжный сигнал, чем `window resize`) и по `visualViewport`/
   * `orientationchange` (клавиатура на iOS Safari не всегда шлёт `resize`
   * окна, но всегда шлёт `visualViewport.resize`).
   */
  useEffect(() => {
    if (!excalidrawAPI) return;
    const container = boardContainerRef.current;
    if (!container) return;

    const refresh = () => excalidrawAPI.refresh();

    const observer = new ResizeObserver(refresh);
    observer.observe(container);

    window.visualViewport?.addEventListener("resize", refresh);
    window.addEventListener("orientationchange", refresh);

    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", refresh);
      window.removeEventListener("orientationchange", refresh);
    };
  }, [excalidrawAPI]);

  /**
   * Э3.9: транслируем собственный viewport (scroll/zoom) в awareness —
   * это НЕ то же самое, что курсор/`pointer` (который уже покрыт
   * `binding.onPointerUpdate` ниже): viewport нужен ученикам, следящим за
   * учителем, чтобы знать, куда именно скроллить свой холст.
   */
  useEffect(() => {
    if (!excalidrawAPI || !provider?.awareness) return;
    const awareness = provider.awareness;
    const broadcastViewport = (scrollX: number, scrollY: number, zoomValue: number) => {
      const container = boardContainerRef.current;
      const viewportState: ViewportAwarenessState = {
        scrollX,
        scrollY,
        zoom: zoomValue,
        containerWidth: container?.clientWidth ?? 0,
        containerHeight: container?.clientHeight ?? 0,
      };
      awareness.setLocalStateField("viewport", viewportState);
    };
    const state = excalidrawAPI.getAppState();
    broadcastViewport(state.scrollX, state.scrollY, state.zoom.value);
    return excalidrawAPI.onScrollChange((scrollX, scrollY, zoom) => broadcastViewport(scrollX, scrollY, zoom.value));
  }, [excalidrawAPI, provider]);

  /**
   * Э3.9: «следовать за учителем» (кнопка в тулбаре ученика) — пока
   * включено, viewport этого клиента подчиняется viewport'у учителя из
   * awareness: та же точка сцены оказывается в центре СВОЕГО контейнера
   * (`centerScrollFor`, см. докстринг типа выше) — зум берём как у
   * учителя (значит, когда он зумирует — зумирует и здесь), но не копируем
   * `scrollX/scrollY` буквально, иначе при другом размере окна получалась
   * обрезка по краю, а не центрированный показ. Учителя среди состояний
   * ищем по `user.role`, а не по фиксированному userId — пришедшая с Э3.1
   * модель прав не завязана на конкретного «главного» участника (со-
   * учителя/подмена тоже были бы `role: "teacher"`).
   */
  useEffect(() => {
    if (!followTeacher || !excalidrawAPI || !provider?.awareness) return;
    const awareness = provider.awareness;
    const applyTeacherViewport = () => {
      const container = boardContainerRef.current;
      if (!container) return;
      for (const state of awareness.getStates().values()) {
        const user = (state as { user?: UserAwarenessState }).user;
        const viewport = (state as { viewport?: ViewportAwarenessState }).viewport;
        if (user?.role === "teacher" && viewport) {
          const centered = centerScrollFor(viewport, container.clientWidth, container.clientHeight);
          excalidrawAPI.updateScene({
            appState: {
              scrollX: centered.scrollX,
              scrollY: centered.scrollY,
              zoom: { value: centered.zoom as NormalizedZoomValue },
            },
          });
          return;
        }
      }
    };
    applyTeacherViewport();
    awareness.on("change", applyTeacherViewport);
    return () => awareness.off("change", applyTeacherViewport);
  }, [followTeacher, excalidrawAPI, provider]);

  /**
   * Recorder (`followUserId` передан, Э10.6 доработка) — тот же приём, что
   * выше у «следовать за учителем», только матчинг по конкретному `user.id`
   * (не по роли: инициатор записи может быть admin, не teacher — прежняя
   * версия матчинга по роли на записи никого не находила и висела на
   * дефолтном viewport'е; см. память по этой доработке от 2026-09-11).
   * Раньше здесь было буквальное копирование чужого scrollX/scrollY — при
   * иной ширине контейнера (лента камер в записи отъедает часть кадра) это
   * визуально резало по краю, а не центрировало (баг, пользователь заметил
   * дважды). Потом — периодический `scrollToContent(fitToViewport)`, но это
   * убивало реальное движение: масштаб/позиция на записи не менялись при
   * панорамировании/зуме у инициатора (пользователь заметил и это). Сейчас
   * — живое центрированное слежение, как у «следовать за учителем»: зум
   * меняется вместе с инициатором, позиция скорректирована под размер
   * контейнера записи.
   */
  useEffect(() => {
    if (!followUserId || !excalidrawAPI || !provider?.awareness) return;
    const awareness = provider.awareness;
    const applyFollowedViewport = () => {
      const container = boardContainerRef.current;
      if (!container) return;
      for (const state of awareness.getStates().values()) {
        const user = (state as { user?: UserAwarenessState }).user;
        const viewport = (state as { viewport?: ViewportAwarenessState }).viewport;
        if (user?.id === followUserId && viewport) {
          const centered = centerScrollFor(viewport, container.clientWidth, container.clientHeight);
          excalidrawAPI.updateScene({
            appState: {
              scrollX: centered.scrollX,
              scrollY: centered.scrollY,
              zoom: { value: centered.zoom as NormalizedZoomValue },
            },
          });
          return;
        }
      }
    };
    applyFollowedViewport();
    awareness.on("change", applyFollowedViewport);
    return () => awareness.off("change", applyFollowedViewport);
  }, [followUserId, excalidrawAPI, provider]);

  function switchPage(pageId: string) {
    ydoc?.getMap("meta").set("activePageId", pageId);
  }

  function addPage() {
    if (!ydoc) return;
    // §6.5: не больше `MAX_BOARD_PAGES` листов доски (слайды презентации не в счёт).
    const boardPages = pages.filter(([, m]) => m.kind !== "image" || !m.slide);
    if (boardPages.length >= MAX_BOARD_PAGES) return;
    const pagesMap = ydoc.getMap<PageMeta>("pages");
    const newId = crypto.randomUUID();
    const nextOrder = pages.reduce((max, [, meta]) => Math.max(max, meta.order), -1) + 1;
    ydoc.transact(() => {
      pagesMap.set(newId, { order: nextOrder, backgroundAssetId: null, kind: "blank" });
      ydoc.getMap("meta").set("activePageId", newId);
    });
  }

  function setPageBackgroundKind(pageId: string, kind: BackgroundKind) {
    if (!ydoc) return;
    const pagesMap = ydoc.getMap<PageMeta>("pages");
    const current = pagesMap.get(pageId);
    if (!current) return;
    pagesMap.set(pageId, { ...current, kind });
  }

  /** Последнюю страницу удалить нельзя — у урока всегда есть хотя бы одна. */
  function deletePage(pageId: string) {
    if (!ydoc || pages.length <= 1) return;
    const pagesMap = ydoc.getMap<PageMeta>("pages");
    const metaMap = ydoc.getMap<unknown>("meta");
    ydoc.transact(() => {
      pagesMap.delete(pageId);
      // Сам именованный Y.Array в реестре типов документа не удаляется —
      // у Yjs нет официального API «убрать shared-тип по имени» (проверено
      // чтением index.d.ts пакета yjs — Y.Doc.share только пополняется).
      // Чистим содержимое, чтобы удалённая страница не тащила за собой
      // мегабайты элементов в бинарном состоянии документа навсегда —
      // единственное, что реально доступно и реально экономит место.
      const orphanedElements = ydoc.getArray(`elements:${pageId}`);
      orphanedElements.delete(0, orphanedElements.length);
      if (metaMap.get("activePageId") === pageId) {
        const remaining = sortedPageEntries(pagesMap);
        if (remaining[0]) metaMap.set("activePageId", remaining[0][0]);
      }
    });
  }

  /**
   * Э4.6/Э4.7, §3.5 ТЗ: импорт слайдов презентации как страниц холста. Каждый
   * слайд → новая страница с `kind: "image"` и фоном-слайдом; поверх можно
   * рисовать как на обычной странице. Навигация синхронная (тот же
   * `activePageId` в `Y.Map "meta"`, что и у обычных страниц) — учитель
   * листает, у всех листается. Повторный импорт той же презентации
   * блокируется: страницы уже на холсте.
   *
   * `renderMode: "pdf"` (Э4.7) — серверных PNG нет, страницу рендерит pdf.js;
   * размеры страниц читаем из самого PDF перед записью в холст (нужны для
   * пропорций мирового прямоугольника слайда).
   */
  async function importDeckSlides(deck: Deck) {
    if (!ydoc) return;
    const pagesMap = ydoc.getMap<PageMeta>("pages");
    if ([...pagesMap.values()].some((m) => m.slide?.deckId === deck.id)) {
      setImportNote(`«${deck.title}» уже на холсте`);
      return;
    }

    let slideRefs: SlidePageRef[];
    if (deck.renderMode === "pdf" && deck.pdfUrl) {
      const pdfUrl = deck.pdfUrl;
      setImportNote(`Открываю «${deck.title}»…`);
      try {
        const sizes = await getPdfPageSizes(pdfUrl);
        slideRefs = sizes.map((sz, i) => ({
          deckId: deck.id,
          index: i,
          width: sz.width,
          height: sz.height,
          pdfUrl,
        }));
      } catch {
        setImportNote(`Не удалось открыть PDF «${deck.title}»`);
        return;
      }
    } else {
      slideRefs = [...deck.slides]
        .sort((a, b) => a.index - b.index)
        .map((s) => ({
          deckId: deck.id,
          index: s.index,
          imageUrl: s.imageUrl,
          thumbUrl: s.thumbUrl,
          width: s.width,
          height: s.height,
        }));
    }
    if (slideRefs.length === 0) return;

    let order = pages.reduce((max, [, meta]) => Math.max(max, meta.order), -1) + 1;
    let firstNewId: string | null = null;
    ydoc.transact(() => {
      for (const slide of slideRefs) {
        const id = crypto.randomUUID();
        if (!firstNewId) firstNewId = id;
        pagesMap.set(id, { order: order++, backgroundAssetId: null, kind: "image", slide });
      }
      if (firstNewId) ydoc.getMap("meta").set("activePageId", firstNewId);
    });
    setImportNote(null);
  }

  /**
   * Э4.6: убрать с холста все страницы одной презентации. Если после этого
   * не осталось ни одной страницы — заводим пустую (у урока всегда минимум
   * одна, как и в `deletePage`).
   */
  function removeDeckSlides(deckId: string) {
    if (!ydoc) return;
    const pagesMap = ydoc.getMap<PageMeta>("pages");
    const metaMap = ydoc.getMap<unknown>("meta");
    const toRemove = [...pagesMap.entries()].filter(([, m]) => m.slide?.deckId === deckId);
    if (toRemove.length === 0) return;
    ydoc.transact(() => {
      for (const [pageId] of toRemove) {
        pagesMap.delete(pageId);
        const orphaned = ydoc.getArray(`elements:${pageId}`);
        orphaned.delete(0, orphaned.length);
      }
      if (pagesMap.size === 0) {
        const blankId = crypto.randomUUID();
        pagesMap.set(blankId, { order: 0, backgroundAssetId: null, kind: "blank" });
      }
      const active = metaMap.get("activePageId");
      if (typeof active === "string" && !pagesMap.has(active)) {
        const remaining = sortedPageEntries(pagesMap);
        if (remaining[0]) metaMap.set("activePageId", remaining[0][0]);
      }
    });
  }

  /**
   * Э3.10, §3.3 ТЗ: «drag&drop, вставка из буфера, с камеры телефона».
   * Штатная вставка картинок самого Excalidraw (paste/drop) уже отключена
   * настройкой `UIOptions.tools.image: false` из Э3.4 — проверено чтением
   * скомпилированного бандла (`isToolSupported("image")` гейтит и
   * `pasteFromClipboard`, и drop-обработчик изображений одним и тем же
   * флагом), поэтому конфликта двойной вставки нет: нативный путь просто
   * ничего не делает с картинкой. Наши обработчики — на CAPTURE-фазе
   * (`onDropCapture`/`onPasteCapture`), чтобы гарантированно сработать
   * раньше внутренних DOM-слушателей Excalidraw на дочерних узлах (bubble-
   * фаза достигла бы их только ПОСЛЕ target-фазы на вложенном canvas).
   */
  async function insertImageFromFile(file: File) {
    if (!excalidrawAPI || !canDraw) return;
    if (pageElementCount >= PAGE_ELEMENT_LIMIT) {
      setUploadError(`На странице уже ${PAGE_ELEMENT_LIMIT} элементов — создайте новую страницу`);
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setUploadError("Поддерживаются только PNG, JPEG, WebP");
      return;
    }
    if (file.size > CANVAS_IMAGE_MAX_BYTES) {
      setUploadError(`Картинка больше ${CANVAS_IMAGE_MAX_BYTES / 1024 / 1024} МБ`);
      return;
    }
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await apiFetch<CanvasImageUploadResponse>(`/lessons/${lessonId}/canvas-images`, {
        method: "POST",
        body: formData,
      });

      const fileId = crypto.randomUUID() as FileId;
      excalidrawAPI.addFiles([
        {
          id: fileId,
          // Сервер провалидировал mimeType тем же enum, что и
          // ACCEPTED_IMAGE_TYPES (canvasImageMimeTypeSchema, packages/shared) —
          // приведение типа сужает string до branded-объединения пакета,
          // а не обходит проверку (не any).
          mimeType: result.mimeType as BinaryFileData["mimeType"],
          dataURL: result.url as DataURL,
          created: Date.now(),
        },
      ]);

      // Формула центра видимой области — то же преобразование координат
      // Excalidraw, что уже проверено и используется в PageBackground.tsx
      // (Э3.7): screenX = (sceneX + scrollX) * zoom ⇒ sceneX = screenX/zoom - scrollX.
      const scale = Math.min(1, PLACED_IMAGE_MAX_SIDE / Math.max(result.width, result.height));
      const placedWidth = result.width * scale;
      const placedHeight = result.height * scale;
      const container = boardContainerRef.current;
      const appState = excalidrawAPI.getAppState();
      const centerX = container ? container.clientWidth / 2 / appState.zoom.value - appState.scrollX : 0;
      const centerY = container ? container.clientHeight / 2 / appState.zoom.value - appState.scrollY : 0;

      const [imageElement] = convertToExcalidrawElements([
        {
          type: "image",
          fileId,
          x: centerX - placedWidth / 2,
          y: centerY - placedHeight / 2,
          width: placedWidth,
          height: placedHeight,
        },
      ]);
      if (imageElement) {
        excalidrawAPI.updateScene({ elements: [...excalidrawAPI.getSceneElements(), imageElement] });
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Не удалось загрузить изображение");
    }
  }

  function handleDragOverCapture(e: React.DragEvent<HTMLDivElement>) {
    if (canDraw) e.preventDefault();
  }

  function handleDropCapture(e: React.DragEvent<HTMLDivElement>) {
    if (!canDraw) return;
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    void insertImageFromFile(file);
  }

  function handlePasteCapture(e: React.ClipboardEvent<HTMLDivElement>) {
    if (!canDraw) return;
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    void insertImageFromFile(file);
  }

  /**
   * Э3.12: как только на странице оказывается больше `PAGE_ELEMENT_LIMIT`
   * живых элементов — обрезаем сцену до первых `PAGE_ELEMENT_LIMIT`.
   * Порядок элементов у `y-excalidraw` детерминирован (дробный индекс
   * `pos`, сортировка в `yjsToExcalidraw`), поэтому `slice(0, LIMIT)` даёт
   * один и тот же набор на всех клиентах — обрезка сходится, а не «воюет»:
   * после неё привязка допишет обрезанный список в общий `Y.Array`, и все
   * участники приходят ровно к 500. `revertingRef` гасит рекурсию
   * `onChange` → `updateScene` → `onChange`. Различать «своё» и «чужое»
   * переполнение не нужно: лимит глобальный, лишние элементы отбрасываются
   * у всех одинаково.
   */
  /** MobileToolRail — активный инструмент/лок берём из `AppState`, а не
   *  дублируем свой источник истины: Excalidraw и так шлёт его в `onChange`
   *  на каждое изменение (включая смену инструмента без единого мазка). */
  function syncRailToolState(appState: { activeTool: { type: string; locked: boolean } }) {
    const type = appState.activeTool.type;
    if (type === "selection" || type === "rectangle" || type === "diamond" || type === "ellipse" ||
        type === "arrow" || type === "line" || type === "freedraw" || type === "text" ||
        type === "eraser" || type === "hand") {
      setRailActiveTool(type);
    }
    setRailLocked(appState.activeTool.locked);
  }

  function handleSceneChange(elements: readonly OrderedExcalidrawElement[]) {
    if (!excalidrawAPI || revertingRef.current) return;
    const live = elements.filter((el) => !el.isDeleted);
    if (live.length <= PAGE_ELEMENT_LIMIT) return;
    revertingRef.current = true;
    excalidrawAPI.updateScene({ elements: live.slice(0, PAGE_ELEMENT_LIMIT) });
    queueMicrotask(() => {
      revertingRef.current = false;
    });
  }

  const activeMeta = pages.find(([id]) => id === activePageId)?.[1] ?? null;
  // Э4.9: заметки докладчика читаем НЕ из Y.Doc (общий документ реплицируется
  // всем участникам целиком, readOnly ограничивает только запись — см.
  // комментарий у toSlideDto в decks/service.ts), а из уже
  // role-gated ответа API (decks проп, GET /lessons/:id/decks): не-учителю
  // сервер всегда отдаёт notes: null, так что доп. проверка isTeacher здесь
  // не для доступа к данным (сервер уже решил), а чтобы не показывать
  // пустой блок остальным.
  const activeSlideNotes =
    isTeacher && activeMeta?.slide
      ? (decks
          .find((d) => d.id === activeMeta.slide!.deckId)
          ?.slides.find((s) => s.index === activeMeta.slide!.index)?.notes ?? null)
      : null;
  // Э4.6: обычные страницы — нумерованными кнопками, страницы-слайды — лентой
  // миниатюр ниже (иначе 40 слайдов дают 40 неразличимых кнопок-номеров).
  const nonSlidePages = pages.filter(([, m]) => m.kind !== "image" || !m.slide);
  const slidePages = pages.filter(([, m]) => m.kind === "image" && m.slide);
  const readyDecks = decks.filter(
    (d) =>
      d.status === "ready" &&
      (d.slides.length > 0 || (d.renderMode === "pdf" && !!d.pdfUrl)),
  );
  const deckPageCount = (d: Deck) => (d.renderMode === "pdf" ? d.slideCount : d.slides.length);
  const importedDeckIds = new Set(
    pages.map(([, m]) => m.slide?.deckId).filter((v): v is string => typeof v === "string"),
  );

  const boardChrome = ydoc ? (
    <div
      className={cn(
        "board-chrome pointer-events-none absolute right-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5",
        // Лента слайдов теперь тоже сверху (см. ниже) — уступаем ей верхнюю
        // строку, только когда она реально есть.
        slidePages.length > 0 ? "top-16" : "top-3",
      )}
    >
      {/* Страницы — компактная лента */}
      <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
        <div className="flex max-w-[40vw] items-center gap-0.5 overflow-x-auto">
          {nonSlidePages.map(([pageId], index) => (
            <button
              key={pageId}
              onClick={() => isTeacher && switchPage(pageId)}
              disabled={!isTeacher}
              aria-current={pageId === activePageId}
              className={cn(
                // size-8, не size-7 — тач-таргет на телефоне/планшете.
                "flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors",
                pageId === activePageId
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                !isTeacher && "cursor-default",
              )}
            >
              {index + 1}
            </button>
          ))}
        </div>
        {/* Добавить/удалить лист — на телефоне/планшете спрятаны отсюда
            (`board-chrome-page-admin`, см. Board.css): места в шапке мало,
            те же действия продублированы пунктами в меню «Ещё» ниже. На
            десктопе видны как обычно, прямыми кнопками. */}
        {isTeacher && (
          <SimpleTooltip
            content={
              nonSlidePages.length >= MAX_BOARD_PAGES
                ? `Максимум ${MAX_BOARD_PAGES} листа`
                : "Добавить лист"
            }
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className="board-chrome-page-admin size-9"
              onClick={addPage}
              disabled={nonSlidePages.length >= MAX_BOARD_PAGES}
              aria-label="Добавить лист"
            >
              <Plus />
            </Button>
          </SimpleTooltip>
        )}
        {isTeacher && activePageId && pages.length > 1 && (
          <SimpleTooltip content="Удалить страницу">
            <Button
              variant="ghost"
              size="icon-sm"
              className="board-chrome-page-admin size-9 text-destructive hover:bg-destructive/10"
              onClick={() => deletePage(activePageId)}
              aria-label="Удалить страницу"
            >
              <Trash2 />
            </Button>
          </SimpleTooltip>
        )}
      </div>

      {/* Действия: undo/redo, фото, ⋯ (доп.), скрыть доску */}
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
        {canDraw && undoState && (
          <>
            <SimpleTooltip content="Отменить (Ctrl+Z)">
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-9"
                onClick={() => undoState.manager.undo()}
                disabled={!undoState.canUndo}
                aria-label="Отменить"
              >
                <Undo2 />
              </Button>
            </SimpleTooltip>
            <SimpleTooltip content="Повторить (Ctrl+Shift+Z)">
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-9"
                onClick={() => undoState.manager.redo()}
                disabled={!undoState.canRedo}
                aria-label="Повторить"
              >
                <Redo2 />
              </Button>
            </SimpleTooltip>
          </>
        )}
        {canDraw && (
          <SimpleTooltip content="Фото на доску">
            <Button asChild variant="ghost" size="icon-sm" className="size-9 cursor-pointer">
              <label aria-label="Фото на доску">
                <ImagePlus aria-hidden />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void insertImageFromFile(file);
                  }}
                />
              </label>
            </Button>
          </SimpleTooltip>
        )}

        {(isTeacher || !isTeacher) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="size-9" aria-label="Ещё">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {!isTeacher && (
                <DropdownMenuItem onSelect={() => setFollowTeacher((v) => !v)}>
                  <Navigation aria-hidden />
                  {followTeacher ? "Не следовать за учителем" : "Следовать за учителем"}
                </DropdownMenuItem>
              )}
              {/* Дубли `board-chrome-page-admin` кнопок из ленты страниц —
                  на телефоне/планшете те скрыты (мало места), пункты меню
                  их единственный путь. На десктопе тоже доступны, лишним не
                  мешает. */}
              {isTeacher && (
                <DropdownMenuItem
                  onSelect={addPage}
                  disabled={nonSlidePages.length >= MAX_BOARD_PAGES}
                >
                  <Plus aria-hidden />
                  {nonSlidePages.length >= MAX_BOARD_PAGES
                    ? `Максимум ${MAX_BOARD_PAGES} листа`
                    : "Добавить лист"}
                </DropdownMenuItem>
              )}
              {isTeacher && activePageId && pages.length > 1 && (
                <DropdownMenuItem
                  onSelect={() => deletePage(activePageId)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 aria-hidden />
                  Удалить страницу
                </DropdownMenuItem>
              )}
              {isTeacher && activePageId && activeMeta?.kind !== "image" && (
                <>
                  <DropdownMenuLabel>Фон страницы</DropdownMenuLabel>
                  {Object.entries(BACKGROUND_KIND_LABELS).map(([kind, label]) => (
                    <DropdownMenuItem
                      key={kind}
                      onSelect={() => setPageBackgroundKind(activePageId, kind as BackgroundKind)}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          (activeMeta?.kind ?? "blank") === kind ? "bg-primary" : "bg-transparent",
                        )}
                        aria-hidden
                      />
                      {label}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {isTeacher && readyDecks.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Импорт слайдов презентации</DropdownMenuLabel>
                  {readyDecks.map((d) => (
                    <DropdownMenuItem
                      key={d.id}
                      onSelect={() => {
                        if (importedDeckIds.has(d.id)) {
                          removeDeckSlides(d.id);
                        } else {
                          void importDeckSlides(d);
                        }
                      }}
                    >
                      <Presentation aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        {d.title} · {deckPageCount(d)}
                        {d.renderMode === "pdf" ? " · PDF" : ""}
                      </span>
                      {importedDeckIds.has(d.id) ? (
                        <span className="text-xs text-destructive">убрать</span>
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {/* Дубль кнопки-крестика справа — на телефоне/планшете та
                  скрыта (`board-chrome-close`), пункт меню — единственный
                  путь туда. */}
              {onClose && isTeacher && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onClose}>
                    <X aria-hidden />
                    Скрыть доску
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {onClose && isTeacher && (
          <span className="board-chrome-close inline-flex items-center">
            <Separator orientation="vertical" className="mx-0.5 h-5" />
            <SimpleTooltip content="Скрыть доску">
              <Button variant="ghost" size="icon-sm" className="size-9" onClick={onClose} aria-label="Скрыть доску">
                <X />
              </Button>
            </SimpleTooltip>
          </span>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {ydoc && isTeacher && slidePages.length > 0 && (
        <SlideSearch
          slides={slidePages.map(([pageId, meta], i) => ({
            pageId,
            slideNumber: i + 1,
            ref: {
              deckId: meta.slide!.deckId,
              index: meta.slide!.index,
              pdfUrl: meta.slide!.pdfUrl,
            },
          }))}
          decks={decks}
          onJump={switchPage}
        />
      )}
      <div
        ref={boardContainerRef}
        className="canvas-board relative min-h-0 flex-1"
        style={{ position: "relative" }}
        onDragOverCapture={handleDragOverCapture}
        onDropCapture={handleDropCapture}
        onPasteCapture={handlePasteCapture}
      >
        <PageBackground
          api={excalidrawAPI}
          kind={activeMeta?.kind ?? "blank"}
          slide={activeMeta?.slide ?? null}
        />
        {!readOnlyChrome && boardChrome}
        {/* Мобильная/планшетная (тач) панель инструментов — см. MobileToolRail.tsx.
            Только когда можно рисовать: без `canDraw` Excalidraw и так read-only
            (viewModeEnabled), выбирать инструмент нечем. На десктопе (мышь) не
            видна — свой нативный вертикальный тулбар Excalidraw уже слева
            (Board.css), здесь просто не нужна вторая копия того же самого. */}
        {!readOnlyChrome && canDraw && excalidrawAPI && (
          <div className="mobile-tool-rail pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2">
            <MobileToolRail excalidrawAPI={excalidrawAPI} activeTool={railActiveTool} locked={railLocked} />
          </div>
        )}
        {(importNote || uploadError || pageElementCount >= PAGE_ELEMENT_WARN_AT) && (
          <div className="pointer-events-none absolute inset-x-3 top-16 z-10 flex flex-col items-center gap-1 text-center">
            {importNote && (
              <span className="rounded-md bg-card/95 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
                {importNote}
              </span>
            )}
            {uploadError && (
              <span className="rounded-md bg-card/95 px-2 py-1 text-xs font-medium text-destructive shadow-sm backdrop-blur">
                {uploadError}
              </span>
            )}
            {pageElementCount >= PAGE_ELEMENT_WARN_AT && (
              <span
                className={cn(
                  "rounded-md bg-card/95 px-2 py-1 text-xs shadow-sm backdrop-blur",
                  pageElementCount >= PAGE_ELEMENT_LIMIT
                    ? "font-semibold text-destructive"
                    : "text-warning",
                )}
              >
                {pageElementCount >= PAGE_ELEMENT_LIMIT
                  ? `Предел ${PAGE_ELEMENT_LIMIT} объектов — добавьте страницу`
                  : `Объектов: ${pageElementCount} / ${PAGE_ELEMENT_LIMIT}`}
              </span>
            )}
          </div>
        )}
        {/* Лента слайдов — сверху, а не снизу (запрос пользователя,
            2026-09-24): снизу она соседствовала с панелью свойств фигуры
            (`.App-menu__left`, тоже низ-центр) и уводила внимание от
            только что открытого инструмента. Шапка доски (boardChrome)
            подвинута ниже (`top-16` вместо `top-3`) РОВНО когда лента
            слайдов есть — незачем сдвигать её всегда, когда слайдов нет. */}
        {ydoc && slidePages.length > 0 && (
          <div className="pointer-events-auto absolute inset-x-3 top-3 z-10 flex gap-1.5 overflow-x-auto rounded-lg bg-card/90 p-1.5 shadow-sm backdrop-blur">
            {slidePages.map(([pageId, meta], i) => (
              <button
                key={pageId}
                onClick={() => isTeacher && switchPage(pageId)}
                disabled={!isTeacher}
                title={`Слайд ${i + 1}`}
                className={`shrink-0 overflow-hidden rounded border ${
                  pageId === activePageId ? "border-primary ring-2 ring-primary/30" : "border-border"
                } ${isTeacher ? "" : "cursor-default"}`}
              >
                <SlideThumb slide={meta.slide!} alt={`Слайд ${i + 1}`} />
              </button>
            ))}
          </div>
        )}
        <div ref={excalidrawWrapperRef} style={{ position: "absolute", inset: 0, zIndex: 1 }}>
          {/* Э12.7 §6.5: y-excalidraw 2.0.12 в setupUndoRedo хардкодит
              querySelector('[aria-label="Undo"]') / "Redo" по родным кнопкам
              Excalidraw. С langCode="ru-RU" их подписи локализованы
              («Отменить» / «Повторить») → querySelector даёт null →
              null.addEventListener роняет всю доску. Держим невидимые
              кнопки-якоря с англ. aria-label первыми в контейнере: слушатели
              y-excalidraw цепляются к ним и не падают. Родные кнопки всё
              равно скрыты (Board.css), Undo/Redo рисуем свои в тулбаре. */}
          <button type="button" aria-label="Undo" tabIndex={-1} aria-hidden className="hidden" />
          <button type="button" aria-label="Redo" tabIndex={-1} aria-hidden className="hidden" />
          <Excalidraw
            excalidrawAPI={(api) => setExcalidrawAPI(api)}
            // Э12.7 §6.5 план-ТЗ: весь интерфейс доски — по-русски.
            langCode="ru-RU"
            initialData={{ appState: { viewBackgroundColor: "transparent" } }}
            // Э3.9: без этого собеседники не увидят курсор — ExcalidrawBinding
            // публикует его в awareness только когда сам вызывается, а вызывает
            // его именно Excalidraw через этот проп, не сам пакет.
            onPointerUpdate={pointerUpdate}
            // Э3.12: откат локальных добавлений сверх лимита 500 (handleSceneChange) +
            // синхронизация активного инструмента для MobileToolRail (syncRailToolState).
            onChange={(elements, appState) => {
              handleSceneChange(elements);
              syncRailToolState(appState);
            }}
            // Э3.8, §5.2 ТЗ: без canDraw — доска read-only. `viewModeEnabled`
            // реактивный проп (не только initialData — проверено чтением
            // скомпилированного бандла: сам компонент подхватывает его на
            // каждое изменение через componentDidUpdate), поэтому просто
            // передаём текущее значение без ручного вызова updateScene.
            viewModeEnabled={!canDraw}
            // Э12.7 §6.5 план-ТЗ: доска в уроке — только рисование. Гамбургер-меню
            // (Открыть / Экспорт / Сбросить холст / Справка / ссылки Excalidraw),
            // кнопку «?» и подсказку-hint прячем; часть — здесь, часть — в Board.css
            // (у Excalidraw для них нет опций, только DOM).
            UIOptions={{
              tools: { image: false },
              canvasActions: {
                changeViewBackgroundColor: false,
                clearCanvas: false,
                export: false,
                loadScene: false,
                saveToActiveFile: false,
                saveAsImage: false,
                toggleTheme: false,
              },
            }}
          />
        </div>
      </div>
      {activeSlideNotes && (
        <div className="mt-2 max-h-32 shrink-0 overflow-y-auto rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm">
          <div className="mb-1 text-xs font-semibold text-warning">Заметки докладчика (видно только вам)</div>
          <p className="whitespace-pre-wrap text-foreground">{activeSlideNotes}</p>
        </div>
      )}
    </div>
  );
}
