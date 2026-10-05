// Проверка 8 отдельно: LiveKit недоступен с самого входа (подмена WebSocket
// для /livekit/ в странице — Network.setBlockedURLs WebSocket не блокирует).
import fs from "node:fs";
import { connectBrowser, openPage, sleep, byText, byLabel } from "./cdp.mjs";
const ORIGIN = "https://213.21.241.28";
const { LID, T_EMAIL, T_PW, OUT } = process.env;
fs.mkdirSync(OUT, { recursive: true });
const checks = [];
const log = (e) => { if (!e.quiet && /CHECK|ERROR|NOTE|exception/.test(e.kind)) console.log(new Date().toISOString().slice(11, 19), e.who || "", e.kind, e.text || ""); };
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); log({ kind: ok ? "CHECK_OK" : "CHECK_FAIL", text: `${name} ${detail ? JSON.stringify(detail) : ""}` }); };
async function waitFor(fn, ms, step = 300) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return { ok: true, ms: Date.now() - t0 }; } catch {} await sleep(step); } return { ok: false, ms: Date.now() - t0 }; }
const bodyHas = (p, t) => p.eval(`document.body.innerText.includes(${JSON.stringify(t)})`).catch(() => false);
const BLOCK = `(() => { window.__blockLk = true; const O = window.WebSocket; function W(url, p) { if (window.__blockLk && String(url).includes('/livekit/')) return new O('wss://127.0.0.1:9/blocked'); return new O(url, p); } W.prototype = O.prototype; Object.setPrototypeOf(W, O); window.WebSocket = W; })();`;
const b = await connectBrowser(process.env.T_CDP);
const T = await openPage(b, "teacher", log);
try {
  await T.goto(`${ORIGIN}/login`);
  await waitFor(() => T.eval("!!document.querySelector('input[type=email]')"), 15000);
  if (await T.eval("!!document.querySelector('input[type=email]')")) {
    await T.click("document.querySelector('input[type=email]')"); await T.type(T_EMAIL);
    await T.click("document.querySelector('input[type=password]')"); await T.type(T_PW);
    await T.click("document.querySelector('button[type=submit]')");
  }
  await waitFor(() => T.eval("location.pathname.startsWith('/lessons')"), 15000);
  const { identifier } = await T.send("Page.addScriptToEvaluateOnNewDocument", { source: BLOCK });
  await T.goto(`${ORIGIN}/lessons/${LID}/room`);
  await waitFor(() => T.eval(`!!${byText("button", "Присоединиться")}`), 30000);
  await sleep(1000);
  await T.click(byText("button", "Присоединиться"));
  const inRoom = await waitFor(() => T.eval(`!!${byLabel("Чат")}`), 30000);
  check("room opens without media", inRoom.ok);
  const t0 = Date.now();
  const early = await waitFor(() => bodyHas(T, "Подключаем звук и видео…"), 8000, 500);
  check("no pill in first 8 s (no noise on normal connect)", !early.ok);
  const pill = await waitFor(() => bodyHas(T, "Подключаем звук и видео…"), 20000, 500);
  check("pill «Подключаем звук и видео…» while media never connected", pill.ok, { sinceRoomMs: Date.now() - t0 });
  await T.shot(`${OUT}/8-media-connecting.png`);
  await T.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  await T.eval("window.__blockLk = false; true");
  const gone = await waitFor(async () => !(await bodyHas(T, "Подключаем звук и видео…")), 90000, 1000);
  check("media connects after unblock (MediaRecovery) → pill gone", gone.ok, { ms: gone.ms });
  await T.shot(`${OUT}/8-media-recovered.png`);
} catch (e) { console.log("ERROR", e); }
fs.writeFileSync(`${OUT}/checks.json`, JSON.stringify(checks, null, 2));
console.log(`RESULT ${checks.filter((c) => c.ok).length}/${checks.length}`);
process.exit(0);
