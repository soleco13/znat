import { connectBrowser, sleep } from "./cdp.mjs";
const B = await connectBrowser(process.env.CDP);
for (const bypass of [true, false]) {
  const { browserContextId } = await B.call("Target.createBrowserContext", {});
  const { targetId } = await B.call("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await B.call("Target.attachToTarget", { targetId, flatten: true });
  const send = (m, p) => B.call(m, p, sessionId); const reqs = new Map();
  B.listeners.set(sessionId, (m, p) => {
    if (m === "Network.requestWillBeSent" && p.request.url.includes("/assets/")) reqs.set(p.requestId, { u: p.request.url.split("/").pop(), type: p.type, h: p.request.headers });
    if (m === "Network.responseReceived" && reqs.get(p.requestId)) Object.assign(reqs.get(p.requestId), { disk: p.response.fromDiskCache, sw: p.response.fromServiceWorker, mem: p.response.fromMemoryCache });
    if (m === "Network.requestServedFromCache" && reqs.get(p.requestId)) reqs.get(p.requestId).served = true;
    if (m === "Network.loadingFinished" && reqs.get(p.requestId)) reqs.get(p.requestId).bytes = p.encodedDataLength;
  });
  await send("Network.enable", {}); if (bypass) await send("Network.setBypassServiceWorker", { bypass: true });
  await send("Page.enable", {}); await send("Runtime.enable", {});
  await send("Page.navigate", { url: "https://213.21.241.28/privacy" }); await sleep(4000);
  const ev = (e) => send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  await ev(`fetch('/assets/index-CZFct07q.js', {credentials:'same-origin', priority:'low'}).then(r=>r.arrayBuffer()).then(b=>b.byteLength)`);
  await ev(`fetch('/assets/RoomPage-BnWyml_P.js', {credentials:'same-origin'}).then(r=>r.arrayBuffer()).then(b=>b.byteLength)`);
  await sleep(500);
  await ev(`import('/assets/RoomPage-BnWyml_P.js').then(()=>1,e=>String(e))`); await sleep(1500);
  await ev(`fetch('/assets/RoomPage-BnWyml_P.js', {credentials:'same-origin'}).then(r=>r.arrayBuffer()).then(b=>b.byteLength)`); await sleep(500);
  console.log("bypass", bypass, (await ev("navigator.serviceWorker.controller ? 'SW' : 'noSW'")).result.value);
  for (const r of reqs.values()) console.log("  ", r.u.padEnd(28), r.type.padEnd(7), "bytes", r.bytes, "disk", r.disk, "mem", r.mem, "sw", r.sw, "served", !!r.served, "mode", r.h["Sec-Fetch-Mode"] || "", r.h["Origin"] ? "Origin" : "");
  await B.call("Target.disposeBrowserContext", { browserContextId });
}
process.exit(0);
