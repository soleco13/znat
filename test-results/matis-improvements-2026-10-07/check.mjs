// Проверка улучшений 2026-10-07 на живом стенде: учитель (админ) + гость.
// Остальные участники подставляются на клиенте учителя через WS (как в
// matis-tile-placeholder-2026-10-06). Код Matís не трогается.
import fs from "node:fs";
import { connectBrowser, openPage, sleep, byText, byLabel } from "../matis-tile-placeholder-2026-10-06/cdp.mjs";

const ORIGIN = "https://213.21.241.28";
const LID = "add87950-752e-43b0-85c3-7628bbc079d5";
const JOIN = "/j/0b0315665c2061b3dd9d6e9713a9b97e8cd3d13b57941c95fecda8ddec5200dc";
const OUT = "/out";
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass: !!pass, detail }); console.log(pass ? "PASS" : "FAIL", name, detail); };
const errors = [];
const log = (e) => { if (e.kind === "exception" || e.kind === "console.error") { errors.push(`${e.who} ${e.kind} ${e.text}`); } };
async function waitFor(fn, ms, step = 300) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch {} await sleep(step); } return null; }

// Перехват WS урока + учёт Wake Lock (только наблюдение).
const TAP = `(() => {
  const O = window.WebSocket;
  window.__roomWs = null; window.__people = {};
  window.WebSocket = function (url, p) {
    const ws = p ? new O(url, p) : new O(url);
    if (String(url).includes('/ws?')) {
      window.__roomWs = ws;
      ws.addEventListener('message', (e) => { try { const m = JSON.parse(e.data);
        if (m.type === 'presence') for (const p of m.participants) window.__people[p.userId] = p;
        if (m.type === 'participant_joined' || m.type === 'participant_updated') window.__people[m.participant.userId] = m.participant;
      } catch {} });
    }
    return ws;
  };
  window.WebSocket.prototype = O.prototype;
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.__wl = [];
  try {
    const wl = navigator.wakeLock;
    if (wl) {
      const orig = wl.request.bind(wl);
      wl.request = async (t) => { window.__wl.push('request'); try { const s = await orig(t); window.__wl.push('granted'); s.addEventListener('release', () => window.__wl.push('released')); return s; } catch (e) { window.__wl.push('denied:' + e.name); throw e; } };
    }
  } catch {}
})();`;

const fake = (i, extra = {}) => ({
  userId: `00000000-0000-4000-8000-${String(2000 + i).padStart(12, "0")}`,
  fullName: ["Анна Смирнова", "Борис Котов", "Вера Лебедева", "Глеб Орлов", "Дина Морозова", "Егор Волков", "Жанна Павлова"][i % 7],
  kind: "guest", role: null, connected: true, handRaised: false, handRaisedAt: null, pinned: false,
  permissions: { canDraw: false, canSpeak: false, canShareScreen: false, canPublishVideo: false },
  joinedAt: new Date(Date.now() - 60000 + i * 1000).toISOString(), ...extra,
});

async function api(token, path, method = "GET", body) {
  const r = await fetch(`${ORIGIN}/api/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.status;
}

const login = await (await fetch(`${ORIGIN}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@school.dev", password: "password123" }) })).json();
const TOKEN = login.accessToken;

const tb = await connectBrowser(process.env.CDP_T);
const gb = await connectBrowser(process.env.CDP_G);
const T = await openPage(tb, "teacher", log);
const G = await openPage(gb, "guest", log);
for (const P of [T, G]) await P.send("Page.addScriptToEvaluateOnNewDocument", { source: TAP });

// ── Учитель входит ──
await T.goto(`${ORIGIN}/login`);
await waitFor(() => T.eval("!!document.querySelector('input[type=email]')"), 20000);
await T.click("document.querySelector('input[type=email]')"); await T.type("admin@school.dev");
await T.click("document.querySelector('input[type=password]')"); await T.type("password123");
await T.click("document.querySelector('button[type=submit]')");
await waitFor(() => T.eval("!location.pathname.startsWith('/login')"), 20000);
await T.goto(`${ORIGIN}/lessons/${LID}/room`);
await waitFor(() => T.eval(`!!${byText("button", "Присоединиться")}`), 30000);
await T.click(byText("button", "Присоединиться"));
ok("teacher joined", await waitFor(() => T.eval("window.__roomWs && window.__roomWs.readyState === 1"), 30000));
await sleep(3000);
const wlT = await waitFor(() => T.eval("window.__wl.includes('request') && window.__wl"), 8000);
ok("wake lock requested after join (teacher)", wlT, JSON.stringify(await T.eval("window.__wl")));

// ── Гость входит по ссылке ──
await G.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await G.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await G.goto(`${ORIGIN}${JOIN}`);
await waitFor(() => G.eval("!!document.querySelector('input')"), 20000);
await G.click("document.querySelector('input')"); await G.type("Ученик Проверка");
await G.click("document.querySelector('[role=checkbox]')"); await sleep(300);
await G.click("document.querySelector('button[type=submit]')");
await waitFor(() => G.eval(`!!${byText("button", "Присоединиться")}`), 30000);
await G.click(byText("button", "Присоединиться"));
ok("guest joined", await waitFor(() => G.eval("window.__roomWs && window.__roomWs.readyState === 1"), 30000));
await sleep(3000);
const guestId = await waitFor(() => T.eval(`Object.values(window.__people).filter(p => p.fullName === 'Ученик Проверка' && p.connected).sort((a, b) => b.joinedAt.localeCompare(a.joinedAt))[0]?.userId`), 15000);
ok("teacher sees guest", guestId, guestId);

// ── Гость: учитель даёт и забирает слово, глушит ──
const st1 = await api(TOKEN, `/lessons/${LID}/participants/${guestId}/permissions`, "PATCH", { canSpeak: false });
await sleep(1500);
const toastOff = await waitFor(() => G.eval(`document.body.innerText.includes('Учитель выключил ваш микрофон')`), 6000);
ok("guest toast: teacher took the word", st1 < 300 && toastOff);
await G.shot(`${OUT}/guest-toast-mic-off.png`);
await sleep(4500);
await api(TOKEN, `/lessons/${LID}/participants/${guestId}/permissions`, "PATCH", { canSpeak: true });
const toastOn = await waitFor(() => G.eval(`document.body.innerText.includes('Учитель дал вам слово')`), 6000);
ok("guest toast: teacher gave the word", toastOn);
await G.shot(`${OUT}/guest-toast-word.png`);
await sleep(4500);
const stMute = await api(TOKEN, `/lessons/${LID}/participants/${guestId}/mute`, "POST");
const toastMute = await waitFor(() => G.eval(`document.body.innerText.includes('Учитель выключил ваш микрофон')`), 6000);
ok("guest toast: teacher muted", stMute < 300 && toastMute, `status ${stMute}`);

// ── Гость: поднять руку → очередь у учителя, опустить все ──
await G.click(`[...document.querySelectorAll('[data-hotkey="H"]')].find(e => e.getClientRects().length)`);
await sleep(1500);
const raised = await waitFor(() => T.eval(`Object.values(window.__people).length >= 0 && document.body.innerText.includes('поднял(а) руку')`), 6000);
ok("teacher hand toast", raised);

// подставные участники с руками (порядок: Вера раньше Анны)
const t0 = Date.now();
const fakes = [fake(0, { handRaised: true, handRaisedAt: new Date(t0 - 5000).toISOString() }), fake(1), fake(2, { handRaised: true, handRaisedAt: new Date(t0 - 20000).toISOString() }), fake(3), fake(4), fake(5)];
await T.eval(`(() => { const ws = window.__roomWs; for (const p of ${JSON.stringify(fakes)}) ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'participant_joined', participant: p }) })); })()`);
await sleep(1200);
await T.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(800);
await T.click(byLabel("Участники")); await sleep(1200);
const queue = await T.eval(`[...document.querySelectorAll('section[aria-label="Поднятые руки"] li')].map(li => li.innerText.replace(/\\s+/g,' '))`);
ok("hands queue ordered by raise time", queue.length >= 3 && queue[0].includes("Вера") && queue[1].includes("Анна"), JSON.stringify(queue));
await T.shot(`${OUT}/teacher-hands-queue-1440.png`);

// пузырь сообщения на плитке (у учителя), закрываем панель
await T.click(byLabel("Участники")); await sleep(600);
await T.eval(`window.__roomWs.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'chat_message', message: { id: crypto.randomUUID(), lessonId: '${LID}', userId: null, authorId: '${fakes[1].userId}', authorName: '${fakes[1].fullName}', body: 'Мне не видно доску', createdAt: new Date().toISOString() } }) }))`);
await sleep(700);
const bubble = await T.eval(`[...document.querySelectorAll('[role=status]')].some(e => e.innerText.includes('Мне не видно доску'))`);
ok("chat bubble on author tile (teacher)", bubble);
await T.shot(`${OUT}/teacher-bubble-1440.png`);
await sleep(5600);
ok("chat bubble disappears after ~5s", !(await T.eval(`[...document.querySelectorAll('[role=status]')].some(e => e.innerText.includes('Мне не видно доску'))`)));

// опустить все
const stLower = await api(TOKEN, `/lessons/${LID}/hands/lower`, "POST", {});
await sleep(1500);
const guestHandDown = await G.eval(`[...document.querySelectorAll('[data-hotkey="H"]')].find(e => e.getClientRects().length)?.getAttribute('aria-pressed')`);
ok("lower all hands (real guest hand down)", stLower === 204 && guestHandDown === "false", `status ${stLower}, aria-pressed ${guestHandDown}`);

// горячие клавиши: C открывает чат у учителя
await T.eval("document.activeElement && document.activeElement.blur()");
await T.key("c", "KeyC", 67); await sleep(800);
const chatOpen = await T.eval(`!!document.querySelector('input[aria-label="Сообщение классу"]')`);
ok("hotkey C opens chat", chatOpen);
// в поле ввода буквы не перехватываются
await T.click(`document.querySelector('input[aria-label="Сообщение классу"]')`); await T.key("c", "KeyC", 67); await sleep(400);
ok("hotkey ignored while typing", await T.eval(`!!document.querySelector('input[aria-label="Сообщение классу"]')`));
await T.key("Escape", "Escape", 27);
// камера: нейтральная кнопка
const camCls = await T.eval(`[...document.querySelectorAll('[data-hotkey="V"]')].find(e => e.getClientRects().length)?.closest('span.inline-flex')?.className || ''`);
ok("camera-off button not red-filled", camCls && !camCls.includes("bg-destructive"), camCls.slice(0, 120));

// ── Раскладки ──
const layouts = [
  { name: "390x844-portrait", width: 390, height: 844, touch: true },
  { name: "844x390-landscape", width: 844, height: 390, touch: true },
  { name: "375x667-portrait", width: 375, height: 667, touch: true },
  { name: "667x375-landscape", width: 667, height: 375, touch: true },
  { name: "1440x900-desktop", width: 1440, height: 900, touch: false },
];
for (const P of [T, G]) {
  for (const vp of layouts) {
    await P.send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: vp.touch });
    await P.send("Emulation.setTouchEmulationEnabled", { enabled: vp.touch, maxTouchPoints: vp.touch ? 5 : 1 });
    await P.send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: vp.touch ? "coarse" : "fine" }, { name: "hover", value: vp.touch ? "none" : "hover" }] }).catch(() => {});
    await sleep(1200);
    const m = await P.eval(`(() => { const main = document.querySelector('main'); const nav = document.querySelector('nav[aria-label="Управление уроком"]');
      const leave = [...document.querySelectorAll('button')].find(b => /Выйти/.test(b.getAttribute('aria-label') || b.innerText) && b.getClientRects().length);
      const lr = leave?.getBoundingClientRect();
      return { coarse: matchMedia('(pointer: coarse)').matches, landscapeLayout: !!nav, stageH: Math.round(main?.getBoundingClientRect().height || 0), stageW: Math.round(main?.getBoundingClientRect().width || 0),
        leaveVisible: !!lr && lr.bottom <= innerHeight && lr.right <= innerWidth, hScroll: document.documentElement.scrollWidth > innerWidth }; })()`);
    const expectLand = vp.touch && vp.width > vp.height;
    ok(`${P.name} ${vp.name}`, m.landscapeLayout === expectLand && m.leaveVisible && !m.hScroll, JSON.stringify(m));
    await P.shot(`${OUT}/${P.name}-${vp.name}.png`);
  }
}

// ── Гость выходит и возвращается ──
await G.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(800);
await G.click(`[...document.querySelectorAll('button')].find(b => /Выйти из урока/.test(b.innerText || b.getAttribute('aria-label')) && b.getClientRects().length)`);
await sleep(1500);
const wlG = await G.eval("window.__wl");
const back = await waitFor(() => G.eval(`!!${byText("button", "Вернуться в урок")}`), 6000);
ok("left screen has 'Вернуться в урок'", back);
await G.shot(`${OUT}/guest-left-return.png`);
await G.click(byText("button", "Вернуться в урок"));
const devCheck = await waitFor(() => G.eval(`!!${byText("button", "Присоединиться")}`), 20000);
ok("return leads back to device check (session restored)", devCheck);
await G.click(byText("button", "Присоединиться"));
ok("guest rejoined after return", await waitFor(() => G.eval("window.__roomWs && window.__roomWs.readyState === 1"), 30000));
const sameColorKey = await waitFor(() => T.eval(`Object.values(window.__people).filter(p => p.fullName === 'Ученик Проверка').length`), 8000);
ok("wake lock released on leave (guest)", JSON.stringify(wlG).includes("released") || JSON.stringify(wlG).includes("denied"), JSON.stringify(wlG));

console.log("exceptions:", errors.length, errors.slice(0, 10));
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
process.exit(0);
