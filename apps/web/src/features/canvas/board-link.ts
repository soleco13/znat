import { useEffect } from "react";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import * as Y from "yjs";

import { linkQuality, useLinkPoor } from "@/shared/link-quality";

/**
 * Адаптация доски под слабую связь — ТОЛЬКО у участника, у которого связь
 * плохая; при нормальной связи всё работает как раньше, без задержек.
 *
 * Качество меряем по самому каналу доски: пинг-понг через stateless-сообщения
 * Hocuspocus. На мобильной сети с потерями TCP держит очередь до повторной
 * отправки — RTT пинга скачет с десятков миллисекунд до сотен, пинги
 * теряются. Решение о режиме сообщаем серверу (`{t:"link",poor}`), и он
 * склеивает поток к этому клиенту (`apps/api/.../canvas/link-adapt.ts`).
 * Здесь же, в режиме слабой связи:
 *  - свои правки уходят раз в `PACED_SEND_MS` одной разницей, а не на каждое
 *    движение пера (`paceUpstream`);
 *  - входящие правки и курсоры перерисовываются раз в кадр, а не на каждое
 *    сообщение пачки (`createCoalescingApi`);
 *  - свой курсор отправляется не чаще раза в `PACED_SEND_MS` (`throttleWhen`).
 */

const PING_INTERVAL_MS = 2000;
/** Нормальный RTT мобильной сети — 50–150 мс; стабильно выше — канал не справляется. */
const RTT_POOR_MS = 400;
const PONG_TIMEOUT_MS = 1500;
export const PACED_SEND_MS = 100;

type LinkMessage = { t: "pong"; i: number };

function parsePong(raw: string): LinkMessage | null {
  try {
    const msg = JSON.parse(raw) as Partial<{ t: unknown; i: unknown }>;
    return msg.t === "pong" && typeof msg.i === "number" ? { t: "pong", i: msg.i } : null;
  } catch {
    return null;
  }
}

/**
 * Пинг по каналу доски: плохие признаки (медленный или потерянный пинг,
 * обрыв) уходят в общий детектор связи устройства (`shared/link-quality.ts`),
 * режим берётся оттуда же — тот же, что у медиа. О смене режима сообщаем
 * серверу, он склеивает поток к этому подключению.
 */
export function useBoardLinkPoor(provider: HocuspocusProvider | null): boolean {
  const poor = useLinkPoor();

  useEffect(() => {
    if (!provider) return;
    // Доска только открылась — её код и документ ещё качаются.
    linkQuality.startGrace();
    let seq = 0;
    let outstanding: { i: number; sentAt: number } | null = null;
    const recentRtt: number[] = [];

    const tick = () => {
      // Фоновая вкладка: браузер душит таймеры, «потерянный» пинг был бы ложным.
      if (document.hidden) {
        outstanding = null;
        return;
      }
      if (outstanding && Date.now() - outstanding.sentAt > PONG_TIMEOUT_MS) {
        outstanding = null;
        linkQuality.reportBad();
      }
      if (!outstanding) {
        outstanding = { i: ++seq, sentAt: Date.now() };
        provider.sendStateless(JSON.stringify({ t: "ping", i: outstanding.i }));
      }
    };

    const onStateless = ({ payload }: { payload: string }) => {
      const pong = parsePong(payload);
      if (!pong || !outstanding || pong.i !== outstanding.i) return;
      const rtt = Date.now() - outstanding.sentAt;
      recentRtt.push(rtt);
      linkQuality.reportRtt(rtt);
      outstanding = null;
      if (recentRtt.length > 4) recentRtt.shift();
      // Один всплеск — не повод; два медленных из последних четырёх — уже канал.
      if (recentRtt.filter((rtt) => rtt > RTT_POOR_MS).length >= 2) linkQuality.reportBad();
    };
    const onDisconnect = () => linkQuality.reportBad();

    provider.on("stateless", onStateless);
    provider.on("disconnect", onDisconnect);
    const interval = setInterval(tick, PING_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      provider.off("stateless", onStateless);
      provider.off("disconnect", onDisconnect);
    };
  }, [provider]);

  // Режим — серверу: при каждой смене и заново после переподключения
  // (серверное подключение новое, флаг на нём потерян).
  useEffect(() => {
    if (!provider) return;
    const report = () => provider.sendStateless(JSON.stringify({ t: "link", poor: linkQuality.isPoor }));
    if (poor) report();
    const onSynced = () => {
      if (linkQuality.isPoor) report();
    };
    provider.on("synced", onSynced);
    return () => {
      provider.off("synced", onSynced);
      if (poor) report();
    };
  }, [provider, poor]);

  return poor;
}

/**
 * Свои правки — раз в `intervalMs` одной разницей от последней отправки.
 * Разница собирается из документа, поэтому промежуточные версии штриха
 * (`y-excalidraw` пишет его целиком на каждое движение) в неё не попадают.
 * Чужие правки из разницы исключены — только свой clientID. Возвращает
 * отмену: досылает накопленное и возвращает штатную отправку провайдера.
 */
export function paceUpstream(provider: HocuspocusProvider, intervalMs = PACED_SEND_MS): () => void {
  const doc = provider.document;
  let sentOwnClock = Y.getState(doc.store, doc.clientID);
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    pending = false;
    const sv = Y.decodeStateVector(Y.encodeStateVector(doc));
    sv.set(doc.clientID, sentOwnClock);
    const update = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(sv));
    sentOwnClock = Y.getState(doc.store, doc.clientID);
    provider.documentUpdateHandler(update, null);
  };
  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === provider) return;
    pending = true;
    if (!timer) timer = setTimeout(flush, intervalMs);
  };

  doc.off("update", provider.boundDocumentUpdateHandler);
  doc.on("update", onUpdate);
  return () => {
    doc.off("update", onUpdate);
    flush();
    doc.on("update", provider.boundDocumentUpdateHandler);
  };
}

/**
 * Обёртка API Excalidraw для `ExcalidrawBinding`: пока `enabled()` — все
 * `updateScene` за кадр сливаются в один (пачка правок после задержки сети
 * даёт одну перерисовку, а не десятки). Выключено — вызовы идут напрямую.
 *
 * Корректность: `getSceneElements` отдаёт ещё не применённую сцену, иначе
 * привязка собрала бы следующую пачку из устаревших элементов; перед любым
 * локальным `onChange` отложенное применяется, иначе привязка сочла бы
 * старую локальную версию элемента правкой и записала её обратно.
 */
/**
 * Ссылка на картинку доски с вариантом отдачи (`/files/*?v=`, сервер —
 * storage/image-variants.ts): при слабой связи — облегчённая (`lite`, до
 * 1000 px), иначе `web` (старые PNG отдаются как WebP того же размера).
 */
export function boardImageUrl(url: string, lite: boolean): string {
  if (!url.startsWith("/files/")) return url;
  const parsed = new URL(url, "https://x");
  parsed.searchParams.set("v", lite ? "lite" : "web");
  return `${parsed.pathname}${parsed.search}`;
}

export function createCoalescingApi(
  api: ExcalidrawImperativeAPI,
  enabled: () => boolean,
  /** Картинки из документа отданы Excalidraw — привязка должна считать их уже известными. */
  onFilesFromDoc?: (fileIds: string[]) => void,
): { api: ExcalidrawImperativeAPI; dispose: () => void } {
  type Scene = Pick<Parameters<ExcalidrawImperativeAPI["updateScene"]>[0], "elements" | "collaborators">;
  let pending: Scene | null = null;
  /** id элементов сцены на момент, когда отложили первое обновление. */
  let idsAtDefer: Set<string> | null = null;
  let frame = 0;

  // Пользователь что-то рисует/тащит/пишет — Excalidraw держит ссылку на
  // этот элемент; подмена сцены отложенным снимком оторвала бы его от сцены
  // (штрих «рассинхронизировался»). В такие моменты применяем сразу.
  const interacting = () => {
    const s = api.getAppState();
    return Boolean(
      s.newElement ||
        s.resizingElement ||
        s.multiElement ||
        s.editingTextElement ||
        s.editingLinearElement ||
        s.selectedElementsAreBeingDragged,
    );
  };

  const flush = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!pending) return;
    const scene = pending;
    const knownIds = idsAtDefer ?? new Set<string>();
    pending = null;
    idsAtDefer = null;
    if (!scene.elements) {
      api.updateScene(scene);
      return;
    }
    // Снимок собран до применения: всё, что за это время поменялось локально
    // (версия выше) или появилось локально (нового id не было при откладывании),
    // берём из текущей сцены, а не из снимка.
    const current = api.getSceneElements();
    const currentById = new Map(current.map((el) => [el.id, el]));
    const pendingIds = new Set(scene.elements.map((el) => el.id));
    const merged = scene.elements.map((el) => {
      const local = currentById.get(el.id);
      return local && local.version > el.version ? local : el;
    });
    for (const el of current) {
      if (!pendingIds.has(el.id) && !knownIds.has(el.id)) merged.push(el);
    }
    api.updateScene({ ...scene, elements: merged });
  };

  // Привязка шлёт только `elements`/`collaborators`; всё остальное (appState,
  // captureUpdate) не склеиваем — применяем сразу, досылая отложенное перед ним.
  const updateScene = ((scene) => {
    if (!enabled() || scene.appState != null || scene.captureUpdate !== undefined || interacting()) {
      flush();
      api.updateScene(scene);
      return;
    }
    if (!pending) idsAtDefer = new Set(api.getSceneElements().map((el) => el.id));
    pending = {
      ...pending,
      ...(scene.elements != null && { elements: scene.elements }),
      ...(scene.collaborators !== undefined && { collaborators: scene.collaborators }),
    };
    if (!frame) frame = requestAnimationFrame(flush);
  }) as ExcalidrawImperativeAPI["updateScene"];
  const getSceneElements: ExcalidrawImperativeAPI["getSceneElements"] = () =>
    (pending?.elements as ReturnType<ExcalidrawImperativeAPI["getSceneElements"]> | undefined) ??
    api.getSceneElements();
  const onChange: ExcalidrawImperativeAPI["onChange"] = (callback) =>
    api.onChange((...args) => {
      flush();
      callback(...args);
    });

  // Картинки из документа: ссылка — с вариантом под текущую связь (в сам
  // документ не пишется), и сразу помечаем их известными привязке — иначе
  // y-excalidraw на следующем onChange записал бы их обратно в документ.
  const addFiles: ExcalidrawImperativeAPI["addFiles"] = (files) => {
    onFilesFromDoc?.(files.map((file) => file.id));
    api.addFiles(files.map((file) => ({ ...file, dataURL: boardImageUrl(file.dataURL, enabled()) as typeof file.dataURL })));
  };

  const proxy = new Proxy(api, {
    get(target, key, receiver) {
      if (key === "addFiles") return addFiles;
      if (key === "updateScene") return updateScene;
      if (key === "getSceneElements") return getSceneElements;
      if (key === "onChange") return onChange;
      return Reflect.get(target, key, receiver);
    },
  });
  return {
    api: proxy,
    dispose: () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pending = null;
      idsAtDefer = null;
    },
  };
}

/** Пока `enabled()` — не чаще раза в `intervalMs`, с последним значением; иначе сразу. */
export function throttleWhen<T>(
  fn: (value: T) => void,
  enabled: () => boolean,
  intervalMs = PACED_SEND_MS,
): (value: T) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: { value: T } | null = null;
  let lastSentAt = 0;
  return (value: T) => {
    if (!enabled()) {
      if (timer) clearTimeout(timer);
      timer = null;
      latest = null;
      fn(value);
      return;
    }
    latest = { value };
    if (timer) return;
    const wait = Math.max(0, lastSentAt + intervalMs - Date.now());
    timer = setTimeout(() => {
      timer = null;
      if (!latest) return;
      lastSentAt = Date.now();
      const { value: last } = latest;
      latest = null;
      fn(last);
    }, wait);
  };
}
