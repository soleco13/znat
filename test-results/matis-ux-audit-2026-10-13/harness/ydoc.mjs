// Оракул доски: сколько элементов на активной странице (читает Y.Doc урока как отдельный клиент-учитель).
const PROV = "/znat/node_modules/.pnpm/@hocuspocus+provider@4.6.0_y-protocols@1.0.7_yjs@13.6.32__yjs@13.6.32/node_modules";
const Y = await import(`${PROV}/yjs/dist/yjs.mjs`);
const { HocuspocusProvider } = await import(`${PROV}/@hocuspocus/provider/dist/hocuspocus-provider.esm.js`);
export async function boardState(origin, lessonId) {
  const login = await fetch(`${origin}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "teacher@school.dev", password: "password123" }) }).then((r) => r.json());
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ url: origin.replace("http", "ws") + "/collab", name: lessonId, document: doc, token: login.accessToken });
  await new Promise((res, rej) => { provider.on("synced", () => res()); setTimeout(() => rej(new Error("sync timeout")), 15000); });
  const page = doc.getMap("meta").get("activePageId");
  const els = doc.getArray(`elements:${page}`).toArray().map((m) => (m.get ? m.get("el") : m.el));
  const live = els.filter((e) => e && !e.isDeleted);
  provider.destroy();
  return { page, live: live.length, total: els.length, types: live.reduce((a, e) => ((a[e.type] = (a[e.type] || 0) + 1), a), {}) };
}
export async function boardElements(origin, lessonId) {
  const login = await fetch(`${origin}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "teacher@school.dev", password: "password123" }) }).then((r) => r.json());
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ url: origin.replace("http", "ws") + "/collab", name: lessonId, document: doc, token: login.accessToken });
  await new Promise((res) => provider.on("synced", () => res()));
  const page = doc.getMap("meta").get("activePageId");
  const els = doc.getArray(`elements:${page}`).toArray().map((m) => ({ pos: m.get("pos"), ...m.get("el") }));
  provider.destroy();
  return els.filter((e) => !e.isDeleted).map((e) => ({ id: e.id.slice(0, 6), pos: e.pos, x: Math.round(e.x), y: Math.round(e.y), v: e.version, updated: e.updated }));
}
