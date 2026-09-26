import { useEffect, useState } from "react";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import * as Y from "yjs";

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
/** Режим снимается, только если столько времени не было ни одного плохого признака. */
const RECOVER_MS = 20_000;
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

/** `true`, пока связь с доской плохая (с гистерезисом `RECOVER_MS`). */
export function useBoardLinkPoor(provider: HocuspocusProvider | null): boolean {
  const [poor, setPoor] = useState(false);

  useEffect(() => {
    if (!provider) return;
    let seq = 0;
    let outstanding: { i: number; sentAt: number } | null = null;
    let lastBadAt = 0;
    let current = false;
    const recentRtt: number[] = [];

    const report = () => provider.sendStateless(JSON.stringify({ t: "link", poor: current }));
    const evaluate = () => {
      const next = lastBadAt > 0 && Date.now() - lastBadAt < RECOVER_MS;
      if (next === current) return;
      current = next;
      setPoor(next);
      report();
    };
    const markBad = () => {
      lastBadAt = Date.now();
      evaluate();
    };

    const tick = () => {
      // Фоновая вкладка: браузер душит таймеры, «потерянный» пинг был бы ложным.
      if (document.hidden) {
        outstanding = null;
        return;
      }
      if (outstanding && Date.now() - outstanding.sentAt > PONG_TIMEOUT_MS) {
        outstanding = null;
        markBad();
      }
      if (!outstanding) {
        outstanding = { i: ++seq, sentAt: Date.now() };
        provider.sendStateless(JSON.stringify({ t: "ping", i: outstanding.i }));
      }
      evaluate();
    };

    const onStateless = ({ payload }: { payload: string }) => {
      const pong = parsePong(payload);
      if (!pong || !outstanding || pong.i !== outstanding.i) return;
      recentRtt.push(Date.now() - outstanding.sentAt);
      outstanding = null;
      if (recentRtt.length > 4) recentRtt.shift();
      // Один всплеск — не повод; два медленных из последних четырёх — уже канал.
      if (recentRtt.filter((rtt) => rtt > RTT_POOR_MS).length >= 2) markBad();
    };
    // Обрыв сокета — тоже признак; после переподключения серверное
    // подключение новое, флаг режима нужно передать заново.
    const onDisconnect = () => markBad();
    const onSynced = () => {
      if (current) report();
    };

    provider.on("stateless", onStateless);
    provider.on("disconnect", onDisconnect);
    provider.on("synced", onSynced);
    const interval = setInterval(tick, PING_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      provider.off("stateless", onStateless);
      provider.off("disconnect", onDisconnect);
      provider.off("synced", onSynced);
      setPoor(false);
    };
  }, [provider]);

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
export function createCoalescingApi(
  api: ExcalidrawImperativeAPI,
  enabled: () => boolean,
): { api: ExcalidrawImperativeAPI; dispose: () => void } {
  type Scene = Pick<Parameters<ExcalidrawImperativeAPI["updateScene"]>[0], "elements" | "collaborators">;
  let pending: Scene | null = null;
  let frame = 0;

  const flush = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!pending) return;
    const scene = pending;
    pending = null;
    api.updateScene(scene);
  };

  // Привязка шлёт только `elements`/`collaborators`; всё остальное (appState,
  // captureUpdate) не склеиваем — применяем сразу, досылая отложенное перед ним.
  const updateScene = ((scene) => {
    if (!enabled() || scene.appState != null || scene.captureUpdate !== undefined) {
      flush();
      api.updateScene(scene);
      return;
    }
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

  const proxy = new Proxy(api, {
    get(target, key, receiver) {
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
