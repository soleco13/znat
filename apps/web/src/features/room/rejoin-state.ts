/**
 * Перезагрузка вкладки посреди урока (2026-10-04, E2E-тест стабильности):
 * раньше после F5 участник снова попадал на экран проверки устройств и без
 * клика «Присоединиться» в урок не возвращался, а камера ученика (её
 * включают уже в уроке) оставалась выключенной.
 *
 * С чем участник вошёл и что у него сейчас включено, держим в query самой
 * страницы урока — localStorage/sessionStorage проекту запрещены, а адрес
 * переживает перезагрузку. Читаем только при `navigation.type === "reload"`:
 * переход по ссылке (в том числе скопированной вместе с этими параметрами)
 * по-прежнему показывает проверку устройств.
 */
export interface RejoinState {
  mic: boolean;
  cam: boolean;
  micId: string | null;
  camId: string | null;
  spkId: string | null;
}

const IN_ROOM = "in";
const FLAGS = ["mic", "cam"] as const;
const IDS = ["micId", "camId", "spkId"] as const;

function isReload(): boolean {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return nav?.type === "reload";
}

export function readRejoinState(): RejoinState | null {
  if (!isReload()) return null;
  const q = new URLSearchParams(window.location.search);
  if (q.get(IN_ROOM) !== "1") return null;
  return {
    mic: q.get("mic") === "1",
    cam: q.get("cam") === "1",
    micId: q.get("micId"),
    camId: q.get("camId"),
    spkId: q.get("spkId"),
  };
}

/** `history.state` не трогаем — в нём ключ записи react-router. */
function replaceSearch(update: (q: URLSearchParams) => void) {
  const url = new URL(window.location.href);
  update(url.searchParams);
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
}

export function writeRejoinState(patch: Partial<RejoinState>) {
  replaceSearch((q) => {
    q.set(IN_ROOM, "1");
    for (const key of FLAGS) {
      const v = patch[key];
      if (v !== undefined) q.set(key, v ? "1" : "0");
    }
    for (const key of IDS) {
      if (!(key in patch)) continue;
      const v = patch[key];
      if (v) q.set(key, v);
      else q.delete(key);
    }
  });
}

/** Участник сам вышел — перезагрузка не должна возвращать его в урок. */
export function clearRejoinState() {
  replaceSearch((q) => {
    for (const key of [IN_ROOM, ...FLAGS, ...IDS]) q.delete(key);
  });
}
