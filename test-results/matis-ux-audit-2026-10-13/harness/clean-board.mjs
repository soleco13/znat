const PROV = "/znat/node_modules/.pnpm/@hocuspocus+provider@4.6.0_y-protocols@1.0.7_yjs@13.6.32__yjs@13.6.32/node_modules";
const Y = await import(`${PROV}/yjs/dist/yjs.mjs`);
const { HocuspocusProvider } = await import(`${PROV}/@hocuspocus/provider/dist/hocuspocus-provider.esm.js`);
const origin = process.env.ORIGIN, lessonId = "7df1a7ae-fa77-4ab4-acb7-db7943e9188d";
const login = await fetch(`${origin}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "teacher@school.dev", password: "password123" }) }).then((r) => r.json());
const doc = new Y.Doc();
const provider = new HocuspocusProvider({ url: origin.replace("http", "ws") + "/collab", name: lessonId, document: doc, token: login.accessToken });
await new Promise((res) => provider.on("synced", () => res()));
let removed = 0;
for (const [name] of doc.share) {
  if (!name.startsWith("elements:")) continue;
  const arr = doc.getArray(name);
  doc.transact(() => { for (let i = arr.length - 1; i >= 0; i--) { const m = arr.get(i); const pos = m.get ? m.get("pos") : m.pos; if (/^z9/.test(pos)) { arr.delete(i, 1); removed++; } } });
}
await new Promise((r) => setTimeout(r, 1500));
console.log("removed", removed);
provider.destroy(); process.exit(0);
