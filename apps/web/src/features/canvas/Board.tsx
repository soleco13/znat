import { useEffect, useRef, useState } from "react";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, NormalizedZoomValue } from "@excalidraw/excalidraw/types";
import type { BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { ExcalidrawBinding } from "y-excalidraw";
import * as Y from "yjs";
import type { CanvasImageUploadResponse } from "@school/shared";
import { useAuthStore } from "../../shared/auth-store.js";
import { apiFetch } from "../../shared/api-client.js";
import { BACKGROUND_KIND_LABELS, PageBackground, type BackgroundKind } from "./PageBackground.js";
import "@excalidraw/excalidraw/index.css";
import "./Board.css";

/** Наибольшая сторона изображения при первой вставке на холст (мировые
 *  единицы, не зависят от zoom) — сервер уже прислал ресайз до 2000px
 *  (Э3.10), это отдельное ограничение под удобный начальный размер на
 *  экране; дальше учитель/ученик масштабирует вручную как обычный элемент. */
const PLACED_IMAGE_MAX_SIDE = 480;

/** Разрешённые для загрузки на доску типы (Э3.10, §3.3 ТЗ) — зеркалит `canvasImageMimeTypeSchema` из packages/shared. */
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Стабильный цвет курсора участника — из userId, без похода на сервер (Э3.9). */
function cursorColorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 70%, 45%)`;
}

type ViewportAwarenessState = { scrollX: number; scrollY: number; zoom: number };
type UserAwarenessState = { name: string; color: string; role: string };

/**
 * Метаданные страницы холста (Э3.6/Э3.7, §3.4/§4.3 ТЗ:
 * `Y.Map "pages"` → `pageId → { backgroundAssetId, order, kind }`).
 * `backgroundAssetId` (фон-изображение) остаётся зарезервированным полем
 * без своего UI — загрузка изображений с ресайзом на сервере через
 * `StorageAdapter` (§1.2/§10.10 ТЗ) это отдельная задача Э3.10, заводить
 * её здесь означало бы смешивать задачи в одном коммите.
 */
type PageMeta = { order: number; backgroundAssetId: string | null; kind: BackgroundKind };

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
 *    `lessonId`/`accessToken`, не пересоздаётся при листании страниц.
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
export function Board({ lessonId, canDraw }: { lessonId: string; canDraw: boolean }) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);
  const me = useAuthStore((s) => s.user);
  const role = me?.role;
  const isTeacher = role === "teacher" || role === "admin";
  const [followTeacher, setFollowTeacher] = useState(false);
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!accessToken) return;

    const doc = new Y.Doc();
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const nextProvider = new HocuspocusProvider({
      url: `${protocol}//${location.host}/collab`,
      name: lessonId,
      document: doc,
      token: accessToken,
    });
    setProvider(nextProvider);

    return () => {
      setProvider(null);
      setPages([]);
      setActivePageId(null);
      nextProvider.destroy();
      doc.destroy();
    };
  }, [lessonId, accessToken]);

  useEffect(() => {
    if (!ydoc) return;
    const pagesMap = ydoc.getMap<PageMeta>("pages");
    const metaMap = ydoc.getMap<unknown>("meta");

    const syncPages = () => setPages(sortedPageEntries(pagesMap));
    const syncActivePage = () => setActivePageId((metaMap.get("activePageId") as string | undefined) ?? null);

    // Идемпотентная инициализация первой страницы для ещё пустого холста —
    // перепроверка внутри transact() сужает (не убирает совсем — Yjs-транзакции
    // синхронные локально, но не атомарны по сети) окно гонки, если два
    // участника открыли пустой урок одновременно; на выходе получится
    // максимум лишняя страница, а не потеря данных.
    ydoc.transact(() => {
      if (pagesMap.size === 0) {
        const firstPageId = crypto.randomUUID();
        pagesMap.set(firstPageId, { order: 0, backgroundAssetId: null, kind: "blank" });
      }
      if (!metaMap.get("activePageId")) {
        metaMap.set("activePageId", sortedPageEntries(pagesMap)[0]![0]);
      }
    });

    syncPages();
    syncActivePage();
    pagesMap.observe(syncPages);
    metaMap.observe(syncActivePage);
    return () => {
      pagesMap.unobserve(syncPages);
      metaMap.unobserve(syncActivePage);
    };
  }, [ydoc]);

  // Экземпляр привязки в состоянии (не только внутри эффекта) — нужен
  // снаружи, чтобы прокинуть `binding.onPointerUpdate` в проп `<Excalidraw
  // onPointerUpdate>` (Э3.9, курсоры собеседников: см. эффект ниже).
  const [binding, setBinding] = useState<ExcalidrawBinding | null>(null);

  useEffect(() => {
    if (!excalidrawAPI || !ydoc || !provider?.awareness || !activePageId) return;
    const yElements = ydoc.getArray<Y.Map<unknown>>(`elements:${activePageId}`);
    const yAssets = ydoc.getMap<unknown>("assets");
    // `awareness` формально помечен опциональным в типах `y-excalidraw`, но
    // это не так на практике: без него конструктор падает с
    // `TypeError: Cannot read properties of undefined (reading 'getStates')`
    // на безусловном (не под `if (this.awareness)`) обращении в конце
    // конструктора — поймано живой проверкой в браузере (Playwright), не
    // по докам/типам пакета.
    const nextBinding = new ExcalidrawBinding(yElements, yAssets, excalidrawAPI, provider.awareness);
    setBinding(nextBinding);
    return () => {
      setBinding(null);
      nextBinding.destroy();
    };
  }, [excalidrawAPI, ydoc, provider, activePageId]);

  /**
   * Э3.9, §3.4 ТЗ: awareness → курсоры собеседников. `y-excalidraw` сам
   * строит `Collaborator`-ов из `state.user?.name`/`color` (см. заметку в
   * Э3.5/Э3.8 про безусловный `getStates()`), но не публикует его САМ —
   * локальное поле `user` в awareness должны выставить мы, иначе
   * собеседники увидят анонимный курсор без имени/цвета.
   */
  useEffect(() => {
    if (!provider?.awareness || !me) return;
    const userState: UserAwarenessState = { name: me.fullName, color: cursorColorFor(me.id), role: me.role };
    provider.awareness.setLocalStateField("user", userState);
  }, [provider, me]);

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
      const viewportState: ViewportAwarenessState = { scrollX, scrollY, zoom: zoomValue };
      awareness.setLocalStateField("viewport", viewportState);
    };
    const state = excalidrawAPI.getAppState();
    broadcastViewport(state.scrollX, state.scrollY, state.zoom.value);
    return excalidrawAPI.onScrollChange((scrollX, scrollY, zoom) => broadcastViewport(scrollX, scrollY, zoom.value));
  }, [excalidrawAPI, provider]);

  /**
   * Э3.9: «следовать за учителем» — пока включено, viewport этого клиента
   * подчиняется viewport'у учителя из awareness. Учителя среди состояний
   * ищем по `user.role`, а не по фиксированному userId — пришедшая с
   * Э3.1 модель прав не завязана на конкретного «главного» участника
   * (со-учителя/подмена тоже были бы `role: "teacher"`).
   */
  useEffect(() => {
    if (!followTeacher || !excalidrawAPI || !provider?.awareness) return;
    const awareness = provider.awareness;
    const applyTeacherViewport = () => {
      for (const state of awareness.getStates().values()) {
        const user = (state as { user?: UserAwarenessState }).user;
        const viewport = (state as { viewport?: ViewportAwarenessState }).viewport;
        if (user?.role === "teacher" && viewport) {
          excalidrawAPI.updateScene({
            appState: {
              scrollX: viewport.scrollX,
              scrollY: viewport.scrollY,
              zoom: { value: viewport.zoom as NormalizedZoomValue },
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

  function switchPage(pageId: string) {
    ydoc?.getMap("meta").set("activePageId", pageId);
  }

  function addPage() {
    if (!ydoc) return;
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
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setUploadError("Поддерживаются только PNG, JPEG, WebP");
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

  return (
    <div>
      {ydoc && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {pages.map(([pageId], index) => (
            <button
              key={pageId}
              onClick={() => isTeacher && switchPage(pageId)}
              disabled={!isTeacher}
              className={`rounded border px-3 py-1 text-sm ${
                pageId === activePageId ? "border-blue-500 bg-blue-50 font-medium" : ""
              } ${isTeacher ? "" : "cursor-default"}`}
            >
              {index + 1}
            </button>
          ))}
          {isTeacher && (
            <button onClick={addPage} className="rounded border px-3 py-1 text-sm">
              + страница
            </button>
          )}
          {isTeacher && activePageId && pages.length > 1 && (
            <button onClick={() => deletePage(activePageId)} className="rounded border px-3 py-1 text-sm text-red-700">
              Удалить страницу
            </button>
          )}
          {isTeacher && activePageId && (
            <select
              value={pages.find(([id]) => id === activePageId)?.[1].kind ?? "blank"}
              onChange={(e) => setPageBackgroundKind(activePageId, e.target.value as BackgroundKind)}
              className="rounded border px-2 py-1 text-sm"
            >
              {Object.entries(BACKGROUND_KIND_LABELS).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
          )}
          {!isTeacher && (
            <button
              onClick={() => setFollowTeacher((v) => !v)}
              className={`rounded border px-3 py-1 text-sm ${followTeacher ? "border-blue-500 bg-blue-50 font-medium" : ""}`}
            >
              {followTeacher ? "Не следовать за учителем" : "Следовать за учителем"}
            </button>
          )}
          {canDraw && (
            <label className="cursor-pointer rounded border px-3 py-1 text-sm">
              Фото на доску
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
          )}
          {uploadError && <span className="text-sm text-red-700">{uploadError}</span>}
        </div>
      )}
      <div
        ref={boardContainerRef}
        className="canvas-board"
        style={{ height: "70vh", position: "relative" }}
        onDragOverCapture={handleDragOverCapture}
        onDropCapture={handleDropCapture}
        onPasteCapture={handlePasteCapture}
      >
        <PageBackground
          api={excalidrawAPI}
          kind={pages.find(([id]) => id === activePageId)?.[1].kind ?? "blank"}
        />
        <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
          <Excalidraw
            excalidrawAPI={(api) => setExcalidrawAPI(api)}
            initialData={{ appState: { viewBackgroundColor: "transparent" } }}
            // Э3.9: без этого собеседники не увидят курсор — ExcalidrawBinding
            // публикует его в awareness только когда сам вызывается, а вызывает
            // его именно Excalidraw через этот проп, не сам пакет.
            onPointerUpdate={binding?.onPointerUpdate}
            // Э3.8, §5.2 ТЗ: без canDraw — доска read-only. `viewModeEnabled`
            // реактивный проп (не только initialData — проверено чтением
            // скомпилированного бандла: сам компонент подхватывает его на
            // каждое изменение через componentDidUpdate), поэтому просто
            // передаём текущее значение без ручного вызова updateScene.
            viewModeEnabled={!canDraw}
            UIOptions={{
              tools: { image: false },
              canvasActions: { changeViewBackgroundColor: false },
            }}
          />
        </div>
      </div>
    </div>
  );
}
