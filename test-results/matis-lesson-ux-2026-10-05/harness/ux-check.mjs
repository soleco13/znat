// Целевая проверка исправлений аудита UX урока (2026-10-05). Не network-chaos:
// условия сети задаются средствами CDP внутри одной вкладки.
import fs from "node:fs";
import { connectBrowser, openPage, sleep, byText, byLabel } from "./cdp.mjs";

const ORIGIN = "https://213.21.241.28";
const { LID, JOIN_PATH, T_EMAIL, T_PW, OUT } = process.env;
fs.mkdirSync(OUT, { recursive: true });
const evOut = fs.createWriteStream(`${OUT}/events.jsonl`);
const log = (e) => { e.t = Date.now(); evOut.write(JSON.stringify(e) + "\n"); if (!e.quiet) console.log(new Date().toISOString().slice(11, 19), e.who || "", e.kind, e.text || e.url || e.status || ""); };
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); log({ kind: ok ? "CHECK_OK" : "CHECK_FAIL", text: `${name} ${detail ? JSON.stringify(detail).slice(0, 300) : ""}` }); };
async function waitFor(fn, ms, step = 300) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return { ok: true, v, ms: Date.now() - t0 }; } catch {} await sleep(step); } return { ok: false, ms: Date.now() - t0 }; }

// Счётчики вызовов, подменяемые до загрузки страницы.
const PROBES = `(() => {
  window.__fetches = [];
  const f = window.fetch.bind(window);
  window.fetch = (input, init) => { try { window.__fetches.push({ url: String(input && input.url || input), method: (init && init.method) || 'GET', t: Date.now() }); } catch {} return f(input, init); };
  window.__gdm = { calls: 0, mode: 'real', delayMs: 0 };
  const md = navigator.mediaDevices;
  if (md && md.getDisplayMedia) {
    const orig = md.getDisplayMedia.bind(md);
    md.getDisplayMedia = async (c) => {
      window.__gdm.calls++;
      if (window.__gdm.mode === 'cancel') { await new Promise(r => setTimeout(r, 700)); throw new DOMException('Permission denied', 'NotAllowedError'); }
      if (window.__gdm.delayMs) await new Promise(r => setTimeout(r, window.__gdm.delayMs));
      return orig(c);
    };
  }
})();`;
const toasts = (p) => p.eval(`[...document.querySelectorAll('[data-sonner-toast]')].map(t => t.innerText.trim())`).catch(() => []);
const bodyHas = (p, text) => p.eval(`document.body.innerText.includes(${JSON.stringify(text)})`).catch(() => false);
const inRoom = (p) => p.eval(`!!${byLabel("Чат")}`).catch(() => false);

const browser = await connectBrowser(process.env.T_CDP);
const T = await openPage(browser, "teacher", log);
await T.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBES });
const sb = await connectBrowser(process.env.S_CDP);
const S = await openPage(sb, "student", log);
await S.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBES });

async function passDeviceCheck(p) {
  const r = await waitFor(() => p.eval(`!!${byText("button", "Присоединиться")}`), 30000);
  if (!r.ok) return false;
  await sleep(1500);
  await p.click(byText("button", "Присоединиться"));
  return (await waitFor(() => inRoom(p), 30000)).ok;
}

try {
  // ── Учитель входит ──
  await T.goto(`${ORIGIN}/login`);
  await waitFor(() => T.eval("!!document.querySelector('input[type=email]')"), 15000);
  await T.click("document.querySelector('input[type=email]')"); await T.type(T_EMAIL);
  await T.click("document.querySelector('input[type=password]')"); await T.type(T_PW);
  await T.click("document.querySelector('button[type=submit]')");
  check("teacher login", (await waitFor(() => T.eval("location.pathname.startsWith('/lessons')"), 15000)).ok);
  await T.goto(`${ORIGIN}/lessons/${LID}/room`);
  check("teacher in room", await passDeviceCheck(T));
  await sleep(4000);

  // ── 1. Демонстрация: отмена окна выбора ──
  await T.eval(`window.__gdm.mode='cancel'; window.__gdm.calls=0; true`);
  await T.click(byLabel("Демонстрация"));
  await sleep(4000);
  const c1 = await T.eval(`window.__gdm.calls`);
  const t1 = await toasts(T);
  check("share cancel: picker opened once", c1 === 1, { calls: c1 });
  check("share cancel: no error toast", !t1.some((x) => /Не удалось|Permission|демонстр/i.test(x)), { toasts: t1 });
  check("share cancel: not sharing", !(await bodyHas(T, "Вы показываете экран")));
  await T.shot(`${OUT}/1-share-cancel.png`);

  // ── 2. Демонстрация: окно выбора открыто 9 с (дольше прежних 6 с) ──
  await T.eval(`window.__gdm.mode='real'; window.__gdm.delayMs=9000; window.__gdm.calls=0; true`);
  await T.click(byLabel("Демонстрация"));
  await sleep(1500);
  const busy = await T.eval(`(() => { const b = ${byLabel("Демонстрация")}; return b ? b.getAttribute('aria-busy') || (b.querySelector('svg.animate-spin, [role=status]') ? 'spin' : null) : 'gone'; })()`);
  // повторные нажатия во время выбора — не должны открыть второе окно
  await T.click(byLabel("Демонстрация")); await T.click(byLabel("Демонстрация"));
  const started = await waitFor(() => bodyHas(T, "Вы показываете экран"), 25000);
  await sleep(8000); // прежний код снимал демонстрацию и открывал выбор повторно
  const c2 = await T.eval(`window.__gdm.calls`);
  const still = await bodyHas(T, "Вы показываете экран");
  check("share slow picker: started", started.ok, { ms: started.ms });
  check("share slow picker: picker opened once (incl. 2 extra clicks)", c2 === 1, { calls: c2, busy });
  check("share slow picker: still sharing after 8 s", still);
  await T.shot(`${OUT}/2-share-slow.png`);

  // ── 3. Остановка ──
  await T.click(byLabel("Остановить демонстрацию"));
  check("share stop", (await waitFor(async () => !(await bodyHas(T, "Вы показываете экран")), 10000)).ok);
  await T.eval(`window.__gdm.delayMs=0; true`);

  // ── 4. Медленная сеть: чат показывает «Отправляется…» ──
  await T.click(byLabel("Чат")); await sleep(800);
  await T.send("Network.emulateNetworkConditions", { offline: false, latency: 2500, downloadThroughput: -1, uploadThroughput: -1 });
  const msg = `ux-${Date.now() % 100000}`;
  await T.click(byLabel("Сообщение классу")); await T.type(msg);
  await T.click(byLabel("Отправить"));
  const pend = await waitFor(() => bodyHas(T, "Отправляется…"), 2000, 100);
  const sent = await waitFor(async () => (await bodyHas(T, msg)) && !(await bodyHas(T, "Отправляется…")), 20000);
  await T.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  check("chat: pending shown while sending", pend.ok, { ms: pend.ms });
  check("chat: confirmed", sent.ok, { ms: sent.ms });
  await T.shot(`${OUT}/4-chat.png`);

  // ── 5. Гость: двойной клик «Продолжить» — один вход ──
  await S.goto(`${ORIGIN}${JOIN_PATH}`);
  await waitFor(() => S.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`), 20000);
  await S.click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await S.type("UX Ученик");
  await S.click(`document.querySelector('[role=checkbox]')`); await sleep(300);
  await S.send("Network.emulateNetworkConditions", { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
  const pt = await S.eval(`(() => { const b = document.querySelector('button[type=submit]').getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2 }; })()`);
  for (let i = 0; i < 3; i++) {
    await S.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
    await S.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
    await sleep(120);
  }
  const enters = await S.eval(`window.__fetches.filter(f => f.method === 'POST' && /\\/j\\//.test(f.url)).map(f => f.url.replace(/[0-9a-f]{20,}/g, '…'))`);
  await S.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  check("guest triple-click: one enter request", enters.length === 1, { enters });
  check("student in room", await passDeviceCheck(S));
  await sleep(5000);

  // ── 6. Недоступная кнопка объясняет причину ──
  const mic = await S.eval(`(() => { const b = [...document.querySelectorAll('button[aria-disabled=true]')].find(e => e.getBoundingClientRect().width > 0); return b ? b.getAttribute('aria-label') : null; })()`);
  if (mic) {
    await S.click(`[...document.querySelectorAll('button[aria-disabled=true]')].find(e => e.getBoundingClientRect().width > 0)`);
    await sleep(700);
    const tt = await toasts(S);
    check("disabled control explains on click", tt.some((x) => /учитель|демонстрир/i.test(x)), { button: mic, toasts: tt });
    await S.shot(`${OUT}/6-disabled-hint.png`);
  } else {
    log({ kind: "NOTE", text: "student has no explain-disabled controls in this lesson (permissions granted)" });
  }

  // ── 7. «Выйти» без сети — уход сразу ──
  await S.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const t7 = Date.now();
  await S.click(byText("button", "Выйти"));
  const left = await waitFor(() => bodyHas(S, "Вы вышли из урока"), 10000, 100);
  check("leave offline: immediate", left.ok && Date.now() - t7 < 3000, { ms: Date.now() - t7 });
  await S.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await S.shot(`${OUT}/7-left.png`);

  // ── 8. Медиа не подключается с самого входа → метка «Подключаем звук и видео…» ──
  const media = await T.eval(`window.__fetches.length`); // прогрев
  await T.send("Network.setBlockedURLs", { urls: ["*:7880*", "*:7881*", "*/rtc*", "*livekit*"] });
  await T.send("Network.enable");
  await T.reload();
  const back = await waitFor(() => inRoom(T), 30000);
  const pill = await waitFor(() => bodyHas(T, "Подключаем звук и видео…"), 25000, 500);
  check("media blocked: room still opens after F5", back.ok);
  check("media never connected: pill shown", pill.ok, { msAfterRoom: pill.ms });
  await T.shot(`${OUT}/8-media-connecting.png`);
  await T.send("Network.setBlockedURLs", { urls: [] });
  const gone = await waitFor(async () => !(await bodyHas(T, "Подключаем звук и видео…")), 60000, 1000);
  check("media recovered after unblock: pill gone", gone.ok, { ms: gone.ms });
  void media;
} catch (e) {
  log({ kind: "ERROR", text: String(e && e.stack || e) });
} finally {
  fs.writeFileSync(`${OUT}/checks.json`, JSON.stringify(checks, null, 2));
  const fails = checks.filter((c) => !c.ok).length;
  console.log(`\nRESULT ${checks.length - fails}/${checks.length}`);
  evOut.end();
  process.exit(0);
}
