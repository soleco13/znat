import { connectBrowser, sleep } from "../matis-tile-placeholder-2026-10-06/cdp.mjs";
const host = process.env.CDP_G; const b = await connectBrowser(host);
const tab = (await (await fetch(`http://${host}/json/list`)).json()).find((t) => t.type === "page" && t.url.includes("/lessons/"));
const { sessionId } = await b.call("Target.attachToTarget", { targetId: tab.id, flatten: true });
await b.call("Page.reload", { ignoreCache: true }, sessionId); await sleep(9000);
const r = await b.call("Runtime.evaluate", { expression: "location.pathname + ' ' + !!document.querySelector('main')", returnByValue: true }, sessionId);
console.log(r.result.value); process.exit(0);
