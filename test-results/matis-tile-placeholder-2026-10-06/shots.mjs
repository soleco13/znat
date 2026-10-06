// Заглушки плиток без камеры на разных экранах. Один реальный админ в комнате,
// остальные участники подставлены на клиенте через перехват WS комнаты.
import fs from "node:fs";
import { connectBrowser, openPage, sleep, byText, byLabel } from "./cdp.mjs";

const ORIGIN = "https://213.21.241.28";
const { LID, OUT = "/out" } = process.env;
fs.mkdirSync(OUT, { recursive: true });
const log = (e) => { if (e.kind === "exception" || e.kind === "console.error") console.log(e.who, e.kind, e.text); };
async function waitFor(fn, ms, step = 300) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch {} await sleep(step); } return null; }

const WS_TAP = `(() => {
  const O = window.WebSocket;
  window.__roomWs = null;
  window.WebSocket = function (url, p) { const ws = p ? new O(url, p) : new O(url); if (String(url).includes('/ws?')) window.__roomWs = ws; return ws; };
  window.WebSocket.prototype = O.prototype;
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
})();`;

const NAMES = ["Анна Смирнова", "Борис Котов", "Вера Лебедева", "Глеб Орлов", "Дина Морозова", "Егор Волков",
  "Жанна Павлова", "Захар Соколов", "Ирина Новикова", "Кирилл Фёдоров", "Лиза Егорова", "Марк Зайцев", "Нина Белова"];
const uuid = (i) => `00000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`;
function fake(i) {
  const staff = i === 0 ? "teacher" : i === 1 ? "methodist" : null;
  return {
    userId: uuid(i), fullName: NAMES[i % NAMES.length], kind: staff ? "staff" : "guest", role: staff,
    connected: true, handRaised: i === 4, pinned: false,
    permissions: { canDraw: false, canSpeak: true, canShareScreen: false, canPublishVideo: false },
    joinedAt: new Date(Date.now() + i * 1000).toISOString(),
  };
}

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900, mobile: false, dpr: 1 },
  { name: "laptop-1280x720", width: 1280, height: 720, mobile: false, dpr: 1 },
  { name: "tablet-820x1180", width: 820, height: 1180, mobile: true, dpr: 2 },
  { name: "phone-390x844", width: 390, height: 844, mobile: true, dpr: 3 },
  { name: "phone-land-844x390", width: 844, height: 390, mobile: true, dpr: 3 },
  { name: "small-phone-360x640", width: 360, height: 640, mobile: true, dpr: 2 },
];
const COUNTS = [1, 3, 7, 13];

const browser = await connectBrowser(process.env.CDP);
const P = await openPage(browser, "admin", log);
await P.send("Page.addScriptToEvaluateOnNewDocument", { source: WS_TAP });

await P.goto(`${ORIGIN}/login`);
await waitFor(() => P.eval("!!document.querySelector('input[type=email]')"), 15000);
await P.click("document.querySelector('input[type=email]')"); await P.type("admin@school.dev");
await P.click("document.querySelector('input[type=password]')"); await P.type("password123");
await P.click("document.querySelector('button[type=submit]')");
await waitFor(() => P.eval("!location.pathname.startsWith('/login')"), 15000);
await P.goto(`${ORIGIN}/lessons/${LID}/room`);
await waitFor(() => P.eval(`!!${byText("button", "Присоединиться")}`), 30000);
await sleep(1500);
await P.shot(`${OUT}/0-precheck.png`);
await P.click(byText("button", "Присоединиться"));
const ok = await waitFor(() => P.eval("window.__roomWs && window.__roomWs.readyState === 1"), 30000);
console.log("in room:", !!ok);
await sleep(4000);
// Камеру себе выключаем, если её включила проверка устройств.
const camOff = await P.click(byText("button", "Камера"));
console.log("camera turned off:", camOff);
await sleep(1500);

const inject = (n) => P.eval(`(() => {
  const ws = window.__roomWs;
  const all = ${JSON.stringify(Array.from({ length: 13 }, (_, i) => fake(i)))};
  for (const p of all) ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'participant_left', userId: p.userId }) }));
  const list = all.slice(0, ${n});
  for (const p of list) ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'participant_joined', participant: p }) }));
  return list.length;
})()`);

const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
for (const vp of VIEWPORTS) {
  if (only && !only.includes(vp.name)) continue;
  await P.send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
  for (const n of COUNTS) {
    try {
      await inject(n);
      await sleep(1200);
      await P.shot(`${OUT}/${vp.name}-n${n + 1}.png`);
    } catch (e) { console.log(vp.name, n, String(e)); }
  }
}
// Панель участников: аватары в списке.
await P.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await inject(7); await sleep(800);
await P.click(byLabel("Участники")); await sleep(1200);
await P.shot(`${OUT}/panel-participants.png`);
console.log("done");
process.exit(0);
