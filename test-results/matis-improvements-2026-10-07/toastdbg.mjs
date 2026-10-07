import { connectBrowser, sleep } from "../matis-tile-placeholder-2026-10-06/cdp.mjs";
const ORIGIN = "https://213.21.241.28", LID = "add87950-752e-43b0-85c3-7628bbc079d5";
const host = process.env.CDP_G; const b = await connectBrowser(host);
const tab = (await (await fetch(`http://${host}/json/list`)).json()).find((t) => t.type === "page" && t.url.includes("/lessons/"));
const { sessionId } = await b.call("Target.attachToTarget", { targetId: tab.id, flatten: true });
const ev = async (e) => (await b.call("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
const tok = (await (await fetch(`${ORIGIN}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@school.dev", password: "password123" }) })).json()).accessToken;
const self = await ev(`fetch('/api/v1/guest/session',{credentials:'include'}).then(r=>r.json())`);
console.log("self", JSON.stringify(self).slice(0, 200));
const gid = self.guestId ?? self.session?.guestId;
for (const v of [false, true]) {
  const r = await fetch(`${ORIGIN}/api/v1/lessons/${LID}/participants/${gid}/permissions`, { method: "PATCH", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ canSpeak: v }) });
  await sleep(1500);
  console.log("canSpeak", v, r.status, await ev(`[...document.querySelectorAll('[data-sonner-toast]')].map(t=>t.innerText).join(' | ') + ' ## ' + document.querySelector('main')?.innerText.slice(0,80)`));
  await sleep(4500);
}
process.exit(0);
