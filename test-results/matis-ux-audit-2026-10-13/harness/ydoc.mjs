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
/** Вписать в доску «повреждённые» записи (как мог бы прислать сломанный или злонамеренный клиент). */
export async function injectCorrupt(origin, lessonId) {
  const login = await fetch(`${origin}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "teacher@school.dev", password: "password123" }) }).then((r) => r.json());
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ url: origin.replace("http", "ws") + "/collab", name: lessonId, document: doc, token: login.accessToken });
  await new Promise((res) => provider.on("synced", () => res()));
  const page = doc.getMap("meta").get("activePageId");
  const arr = doc.getArray(`elements:${page}`);
  const base = { angle: 0, strokeColor: "#e03131", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roundness: null, roughness: 1, opacity: 100, seed: 1, version: 1, versionNonce: 1, index: null, isDeleted: false, groupIds: [], frameId: null, boundElements: null, updated: Date.now(), link: null, locked: false };
  arr.push([
    new Y.Map(Object.entries({ pos: "z9999", el: { ...base, id: "bad-pos-1", type: "rectangle", x: 100, y: 100, width: 80, height: 60 } })),
    new Y.Map(Object.entries({ pos: "a5", el: { ...base, type: "rectangle", x: 0, y: 0, width: 10, height: 10 } })), // без id
    new Y.Map(Object.entries({ pos: "a6" })), // без элемента
    new Y.Map(Object.entries({ pos: "!!", el: "not-an-object" })),
  ]);
  await new Promise((r) => setTimeout(r, 1500));
  provider.destroy();
}
