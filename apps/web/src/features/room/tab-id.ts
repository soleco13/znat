/**
 * Id вкладки для входа в урок (2026-10-17, несколько вкладок с аккаунта
 * персонала): сервер по нему отдаёт вкладке её слот (`<id>`, `<id>~2` …),
 * и F5 или переподключение не занимают новый.
 *
 * Живёт в `window.name` — он переживает перезагрузку вкладки и у каждой
 * вкладки свой. Не localStorage/sessionStorage (CLAUDE.md): там он был бы
 * общим для вкладок или копировался бы при дублировании.
 */
const PREFIX = "matis-tab:";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function newId(): string {
  // `randomUUID` — только в защищённом контексте (https); на http — вручную.
  const c = crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function currentTabId(): string {
  const saved = window.name.startsWith(PREFIX) ? window.name.slice(PREFIX.length) : "";
  if (UUID_RE.test(saved)) return saved;
  return renewTabId();
}

/**
 * Новый id: дубликат вкладки (браузер копирует `window.name`) занял наш слот
 * — LiveKit отключил нас как `DUPLICATE_IDENTITY`; со свежим id вход
 * получает свой слот и никого не выбивает.
 */
export function renewTabId(): string {
  const id = newId();
  window.name = PREFIX + id;
  return id;
}
