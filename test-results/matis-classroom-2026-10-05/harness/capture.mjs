// Запись реальной последовательности запросов гостя: /j/:token → урок → 15 с в уроке.
import { connectBrowser, sleep, byText, byLabel } from "./cdp.mjs";
const ORIGIN = "https://213.21.241.28";
const b = await connectBrowser(process.env.S_CDP);
const { targetId } = await b.call("Target.createTarget", { url: "about:blank" });
const { sessionId } = await b.call("Target.attachToTarget", { targetId, flatten: true });
const send = (m, p) => b.call(m, p, sessionId);
const t0 = Date.now(); const reqs = [];
b.listeners.set(sessionId, (m, p) => {
  if (m === "Network.requestWillBeSent" && /\/api\/|\/ws|\/collab|\/livekit/.test(p.request.url) )
    reqs.push({ t: Date.now() - t0, m: p.request.method, u: p.request.url.replace(ORIGIN, "").replace(/[0-9a-f]{40,}/g, "TOKEN").replace(/[0-9a-f-]{36}/g, "ID").replace(/(token|access_token|join_request)=[^&]+/g, "$1=…").slice(0, 120) });
  if (m === "Network.webSocketCreated") reqs.push({ t: Date.now() - t0, m: "WS", u: p.url.replace(/[0-9a-f-]{36}/g, "ID").replace(/(token|access_token|join_request|cs)=[^&]+/g, "$1=…").slice(0, 120) });
  if (m === "Network.responseReceived" && /\/api\//.test(p.response.url)) reqs.push({ t: Date.now() - t0, m: "<-", u: `${p.response.status} ${p.response.url.replace(ORIGIN, "").replace(/[0-9a-f]{40,}/g, "TOKEN").replace(/[0-9a-f-]{36}/g, "ID").slice(0, 90)}` });
});
await send("Network.enable"); await send("Runtime.enable");
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.value;
const click = async (expr) => { const pt = await ev(`(() => { const el = ${expr}; if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2 }; })()`); if (!pt) return false; for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button: "left", clickCount: 1 }); return true; };
await send("Page.navigate", { url: ORIGIN + process.env.JOIN_PATH });
for (let i = 0; i < 40 && !(await ev(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`)); i++) await sleep(500);
await click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await send("Input.insertText", { text: "Захват Запросов" });
await click(`document.querySelector('[role=checkbox]')`); await sleep(300);
await click(`document.querySelector('button[type=submit]')`);
for (let i = 0; i < 40 && !(await ev(`!!${byText("button", "Присоединиться")}`)); i++) await sleep(500);
reqs.push({ t: Date.now() - t0, m: "--", u: "device check shown" }); await sleep(1500);
await click(byText("button", "Присоединиться"));
for (let i = 0; i < 40 && !(await ev(`!!${byLabel("Чат")}`)); i++) await sleep(500);
reqs.push({ t: Date.now() - t0, m: "--", u: "in room" });
await sleep(15000);
await click(byText("button", "Выйти")); await sleep(1500);
for (const r of reqs) console.log(String(r.t).padStart(6), r.m.padEnd(5), r.u);
process.exit(0);
