// Обрыв сети гостя (iptables снаружи + офлайн браузера) и время возврата WS урока и медиа.
import { connectBrowser, sleep } from "../matis-tile-placeholder-2026-10-06/cdp.mjs";
import fs from "node:fs";
const host = process.env.CDP_G; const b = await connectBrowser(host);
const tab = (await (await fetch(`http://${host}/json/list`)).json()).find((t) => t.type === "page" && t.url.includes("/lessons/"));
const { sessionId } = await b.call("Target.attachToTarget", { targetId: tab.id, flatten: true });
const ev = async (e) => (await b.call("Runtime.evaluate", { expression: e, returnByValue: true }, sessionId)).result.value;
await b.call("Network.enable", {}, sessionId);
const state = () => ev(`(() => { const t = document.body.innerText; return { ws: /Переподключение…|Нет связи|Подключение…/.test(t) ? 0 : 1, mediaPill: t.includes('звук и видео…'), overlay: t.includes('Связь прервалась') }; })()`);
const phase = process.argv[2];
if (phase === "probe") { console.log(JSON.stringify(await state()), await ev(`[...document.querySelectorAll('header span, [role=alertdialog]')].map(e => e.innerText).filter(t => /связ|Подключ|Переподкл|звук/i.test(t)).join(' | ')`)); }
if (phase === "off") { await b.call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId); console.log("offline", JSON.stringify(await state())); }
if (phase === "on") {
  await b.call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId);
  const t0 = Date.now(); let wsAt = null, mediaAt = null; const tl = [];
  let sawDown = false;
  for (let i = 0; i < 120; i++) { const s = await state(); tl.push([Date.now() - t0, s]);
    if (s.ws === 0 || s.mediaPill) sawDown = true;
    if (wsAt === null && s.ws === 1 && (sawDown || i > 1)) wsAt = Date.now() - t0;
    if (wsAt !== null && !s.mediaPill && mediaAt === null && i > 2) mediaAt = Date.now() - t0;
    if (wsAt !== null && mediaAt !== null) break; await sleep(500); }
  console.log(JSON.stringify({ wsReconnectMs: wsAt, mediaOkMs: mediaAt, sawDown, first: tl[0], last: tl.at(-1) }));
}
process.exit(0);
