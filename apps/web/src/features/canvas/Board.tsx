import { useEffect, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { ExcalidrawBinding } from "y-excalidraw";
import * as Y from "yjs";
import { useAuthStore } from "../../shared/auth-store.js";
import { BACKGROUND_KIND_LABELS, PageBackground, type BackgroundKind } from "./PageBackground.js";
import "@excalidraw/excalidraw/index.css";
import "./Board.css";

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
 */
export function Board({ lessonId }: { lessonId: string }) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);
  const role = useAuthStore((s) => s.user?.role);
  const isTeacher = role === "teacher" || role === "admin";

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

  useEffect(() => {
    if (!excalidrawAPI || !ydoc || !provider?.awareness || !activePageId) return;
    const yElements = ydoc.getArray<Y.Map<unknown>>(`elements:${activePageId}`);
    const yAssets = ydoc.getMap<unknown>("assets");
    // `awareness` формально помечен опциональным в типах `y-excalidraw`, но
    // это не так на практике: без него конструктор падает с
    // `TypeError: Cannot read properties of undefined (reading 'getStates')`
    // на безусловном (не под `if (this.awareness)`) обращении в конце
    // конструктора — поймано живой проверкой в браузере (Playwright), не
    // по докам/типам пакета. Курсоры/имена собеседников (Э3.9) при этом
    // ещё не настроены — `provider.awareness` передаётся только чтобы не
    // упасть, локальное состояние (`user.name`/`color`) нигде не выставляется.
    const binding = new ExcalidrawBinding(yElements, yAssets, excalidrawAPI, provider.awareness);
    return () => binding.destroy();
  }, [excalidrawAPI, ydoc, provider, activePageId]);

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
        </div>
      )}
      <div className="canvas-board" style={{ height: "70vh", position: "relative" }}>
        <PageBackground
          api={excalidrawAPI}
          kind={pages.find(([id]) => id === activePageId)?.[1].kind ?? "blank"}
        />
        <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
          <Excalidraw
            excalidrawAPI={(api) => setExcalidrawAPI(api)}
            initialData={{ appState: { viewBackgroundColor: "transparent" } }}
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
