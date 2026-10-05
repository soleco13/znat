// Классный аудит Матис (2026-10-05): 1 учитель (настоящий Chrome) + до 30
// учеников-ботов (API/WS как у браузера + LiveKit через lk). Фазы — PHASES.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { connectBrowser, openPage, byText, byLabel } from "./cdp.mjs";
import {
  ORIGIN, OUT, Bot, Http, PROBE, api, check, checks, log, mark, perfDelta, perfSample, rel, rtcSummary, sleep, stats, waitFor,
} from "./lib.mjs";

const LID = process.env.LID;
const JOIN_PATH = process.env.JOIN_PATH;
const N = Number(process.env.STUDENTS || 29);
const PHASES = (process.env.PHASES || "storm,speaker,dynamic,cams,share,resize,panels,realtime,answers,interact,lecture,reconnect").split(",");
const SOAK_MIN = Number(process.env.SOAK_MIN || 0);
const cfg = { lessonId: LID, joinPath: JOIN_PATH };
fs.mkdirSync(`${OUT}/shots`, { recursive: true });

let phase = "setup";
const setPhase = (p) => { phase = p; mark(`PHASE ${p}`); };

// ── учитель ──────────────────────────────────────────────────────────────
const tb = await connectBrowser(process.env.T_CDP);
const T = await openPage(tb, "teacher", (e) => { if (/exception|CRASH|http5xx/.test(e.kind)) log({ ...e, kind: `teacher.${e.kind}` }); });
await T.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
await T.send("Performance.enable", { timeDomain: "timeTicks" });
let VIEW = { width: 1440, height: 900 };
const setView = async (w, h) => { VIEW = { width: w, height: h }; await T.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }); };
await setView(1440, 900);
// «Слабый компьютер учителя»: CPU вкладки замедлен в THROTTLE раз.
if (Number(process.env.THROTTLE || 0) > 1) await T.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.THROTTLE) });
const shot = async (name) => { await T.shot(`${OUT}/shots/${name}.png`).catch(() => {}); };
const tEval = (e) => T.eval(e).catch(() => null);
const inRoom = () => T.eval(`!!${byLabel("Чат")}`).catch(() => false);

// Настоящие ученики-браузеры (активный спикер, производительность у ученика).
const SB = [];
for (const [k, host] of [process.env.S1_CDP, process.env.S2_CDP, process.env.S3_CDP].entries()) {
  if (!host) continue;
  const b = await connectBrowser(host);
  const p = await openPage(b, `sb${k + 1}`, (e) => { if (/exception|CRASH|http5xx/.test(e.kind)) log({ ...e, kind: `sb.${e.kind}` }); });
  await p.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
  await p.send("Performance.enable", { timeDomain: "timeTicks" });
  await p.send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  p.label = `Живой ученик ${"ABC"[k]}`;
  SB.push(p);
}
async function sbEnter(p) {
  await p.goto(`${ORIGIN}${JOIN_PATH}`);
  await waitFor(() => p.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`), 30000);
  await p.click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await p.type(p.label);
  await p.click(`document.querySelector('[role=checkbox]')`); await sleep(300);
  await p.click("document.querySelector('button[type=submit]')");
  await waitFor(() => p.eval(`!!${byText("button", "Присоединиться")}`), 30000);
  await sleep(1500);
  await p.click(byText("button", "Присоединиться"));
  return (await waitFor(() => p.eval(`!!${byLabel("Чат")}`), 30000)).ok;
}
async function sbMic(p, on) {
  const cur = await p.eval(`(() => { const b = ${byLabel("Микрофон")} || ${byLabel("Включить звук")}; return b ? b.getAttribute('aria-pressed') : null; })()`).catch(() => null);
  if (cur !== null && (cur === "true") !== on) await p.click(`${byLabel("Микрофон")} || ${byLabel("Включить звук")}`);
}
const sbIdentity = (p) => p.eval(`fetch('/api/v1/guest/session', { credentials: 'include' }).then(r => r.json()).then(j => j.guestId || null)`).catch(() => null);

const teacherApi = new Http("teacher-api");
{
  teacherApi.credentials = { email: process.env.T_EMAIL, password: process.env.T_PW };
  const r = await teacherApi.req("POST", "/auth/login", teacherApi.credentials);
  teacherApi.bearer = r.json?.accessToken;
  check("teacher api login", !!teacherApi.bearer, { status: r.status });
}

async function teacherEnter() {
  await T.goto(`${ORIGIN}/login`);
  await waitFor(() => T.eval("!!document.querySelector('input[type=email]')"), 20000);
  await T.click("document.querySelector('input[type=email]')"); await T.type(process.env.T_EMAIL);
  await T.click("document.querySelector('input[type=password]')"); await T.type(process.env.T_PW);
  await T.click("document.querySelector('button[type=submit]')");
  await waitFor(() => T.eval("location.pathname.startsWith('/lessons')"), 20000);
  await T.goto(`${ORIGIN}/lessons/${LID}/room`);
  await waitFor(() => T.eval(`!!${byText("button", "Присоединиться")}`), 30000);
  await sleep(1500);
  await T.click(byText("button", "Присоединиться"));
  const ok = (await waitFor(inRoom, 30000)).ok;
  await sleep(4000);
  // Микрофон учителя выключен — включается только в его «реплику» (фаза спикеров).
  await setMic(false);
  return ok;
}
async function setMic(on) {
  const cur = await tEval(`(() => { const b = ${byLabel("Микрофон")} || ${byLabel("Включить звук")}; return b ? b.getAttribute('aria-pressed') : null; })()`);
  if (cur !== null && (cur === "true") !== on) await T.click(`${byLabel("Микрофон")} || ${byLabel("Включить звук")}`);
}
/** Клик + время до видимого результата (по выражению) — «отзывчивость» глазами учителя. */
async function timedClick(label, clickExpr, doneExpr, timeoutMs = 10000) {
  const t0 = Date.now();
  const clicked = await T.click(clickExpr).catch(() => false);
  const r = await waitFor(() => T.eval(doneExpr), timeoutMs, 30);
  const ms = Date.now() - t0;
  log({ kind: "interact", text: label, extra: { clicked, ok: r.ok, ms } });
  return { label, ok: clicked && r.ok, ms };
}

// ── ученики ──────────────────────────────────────────────────────────────
const bots = [];
for (let i = 1; i <= Math.max(N, 30); i++) bots.push(new Bot(i, cfg));
const active = () => bots.filter((b) => !b.left);
async function botIn(b, { video = false, audio = null } = {}) {
  const t0 = Date.now();
  try {
    if (!b.entered) { await b.enter(); b.entered = true; }
    await b.join();
    b.openWs();
    const p = await waitFor(() => b.timeline.presenceAt, 30000, 100);
    if (video || audio) b.startMedia({ video, audio }); else b.startMedia({ presence: true });
    return { ok: p.ok, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, err: String(e).slice(0, 200) };
  }
}
const lkList = () => {
  const r = spawnSync("lk", ["--url", process.env.LK_URL, "--api-key", process.env.LK_KEY, "--api-secret", process.env.LK_SECRET, "room", "participants", "list", `lesson-${LID}`], { encoding: "utf8", timeout: 15000 });
  const lines = (r.stdout || "").split("\n").filter((l) => /\((ACTIVE|JOINING|JOINED|DISCONNECTED)\)/.test(l));
  const ids = lines.map((l) => l.split(" ")[0]);
  return { total: lines.length, active: lines.filter((l) => /ACTIVE/.test(l)).length, dup: ids.length - new Set(ids).size, tracks: lines.reduce((s, l) => s + Number((l.match(/tracks: (\d+)/) || [0, 0])[1]), 0) };
};

// ── фоновый сэмплер: производительность учителя каждые 10 с ───────────────
let prevPerf = null;
let stopSampler = false;
const perfLog = [];
(async () => {
  while (!stopSampler) {
    const s = await perfSample(T).catch(() => null);
    if (s && prevPerf && s.frames != null) {
      const d = perfDelta(prevPerf, s);
      const bs = { inRoom: active().length, ws: active().filter((b) => b.wsState === "connected").length, lk: active().filter((b) => b.lk).length, cams: active().filter((b) => b.lkWanted?.video).length };
      const ev = (s.events || []).map((e) => e.d);
      const row = { phase, ...d, ...bs, slowEvents: ev.length ? Math.max(...ev) : 0, cdp: s.cdp };
      perfLog.push({ t: s.t, ...row });
      log({ kind: "perf", text: phase, extra: row, quiet: true });
    }
    if (s && s.frames != null) prevPerf = s;
    await sleep(10000);
  }
})();
let stopRtc = false;
(async () => {
  while (!stopRtc) {
    await sleep(30000);
    const r = await rtcSummary(T).catch(() => null);
    if (r) log({ kind: "rtc", text: phase, extra: r, quiet: true });
  }
})();
/** Сводка за окно фазы. */
function windowStats(from, to = Date.now()) {
  const rows = perfLog.filter((r) => r.t >= from && r.t <= to);
  const f = (k) => rows.map((r) => r[k]).filter((v) => typeof v === "number");
  const sum = (k) => f(k).reduce((a, b) => a + b, 0);
  const avg = (k) => (f(k).length ? +(sum(k) / f(k).length).toFixed(1) : null);
  return {
    samples: rows.length, fpsAvg: avg("fps"), fpsMin: f("fps").length ? Math.min(...f("fps")) : null, longTaskPct: avg("longTaskPct"), taskPct: avg("taskPct"),
    commitsPerSec: avg("commitsPerSec"), fnRendersPerSec: avg("fnRendersPerSec"), videoRenders: sum("videoRenders"), videoMounts: sum("videoMounts"),
    tileMoves: sum("tileMoves"), gridChanges: sum("gridChanges"), decodedFps: avg("decodedFps"), dropped: sum("droppedFrames"), layoutPerSec: avg("layoutPerSec"),
    recalcMsPerSec: avg("recalcMsPerSec"), videosVisible: rows.at(-1)?.videosVisible, videosPlaying: rows.at(-1)?.videosPlaying, dom: rows.at(-1)?.dom, heapMB: rows.at(-1)?.heapMB, slowEventMax: f("slowEvents").length ? Math.max(...f("slowEvents")) : 0,
  };
}
const apiWindow = (from, to = Date.now()) => {
  const rows = api.filter((r) => r.t >= from && r.t <= to);
  const by = {};
  for (const r of rows) (by[r.route] ||= []).push(r);
  const out = {};
  for (const [k, v] of Object.entries(by)) out[k] = { ...stats(v.map((x) => x.ms)), errors: v.filter((x) => x.status >= 400 || x.err).map((x) => x.status || x.err).filter((s) => s !== 401 || !k.includes("refresh")) };
  return out;
};
const summary = {};
const saveSummary = () => fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
const hold = async (sec, tag) => { const t0 = Date.now(); await sleep(sec * 1000); const w = windowStats(t0); log({ kind: "window", text: tag, extra: w }); return w; };
const headCount = (g) => Number((g?.head || "").match(/(\d+) участник/)?.[1] || 0);
const gridInfo = () => tEval(`(() => { const g = [...document.querySelectorAll('div.grid')].find((d) => /repeat\\(/.test(d.style.gridTemplateColumns || '')); const head = [...document.querySelectorAll('header span')].map(s => s.textContent).find(t => /участник/.test(t||'')); const more = [...document.querySelectorAll('button')].find(b => /ещё участников/.test(b.textContent||'')); const pageInfo = [...document.querySelectorAll('span')].find(s => /показаны/.test(s.textContent||'')); if (!g) return { head, grid: null }; const c = g.children[0]?.getBoundingClientRect(); const gr = g.getBoundingClientRect(); return { head, grid: g.style.gridTemplateColumns, cells: g.children.length, tileW: c ? Math.round(c.width) : 0, tileH: c ? Math.round(c.height) : 0, areaW: Math.round(gr.width), areaH: Math.round(gr.height), more: more ? more.textContent.trim() : null, page: pageInfo ? pageInfo.textContent : null, scrollH: document.querySelector('main')?.scrollHeight, clientH: document.querySelector('main')?.clientHeight }; })()`);

// ══════════════════════════════════════════════════════════════════════════
try {
  setPhase("setup");
  check("teacher in room", await teacherEnter());
  await shot("00-teacher-alone");
  summary.setup = { lk: lkList(), grid: await gridInfo() };

  // ── ЧАСТЬ 3. Join storm: 29 учеников почти одновременно ─────────────────
  if (PHASES.includes("storm")) {
    setPhase("storm");
    const t0 = Date.now();
    const camsOn = new Set([2, 5, 9, 12, 16, 20, 23, 27]); // 8 камер — «обычный класс»
    if (process.env.STORM_CAMS === "all") for (let i = 1; i <= N; i++) camsOn.add(i);
    const res = await Promise.all(bots.slice(0, N).map(async (b) => {
      await sleep(Math.random() * 3000); // все открыли ссылку в течение ~3 с
      return { i: b.i, ...(await botIn(b, { video: camsOn.has(b.i) })) };
    }));
    const sbOk = await Promise.all(SB.map((p) => sbEnter(p)));
    check(`storm: live student browsers in ${sbOk.filter(Boolean).length}/${SB.length}`, sbOk.every(Boolean));
    const okN = res.filter((r) => r.ok).length;
    const teacherSees = await waitFor(async () => { const g = await gridInfo(); return headCount(g) >= N + 1 + SB.length ? g : null; }, 60000, 200);
    const tTeacher = Date.now() - t0;
    const videosOn = await waitFor(async () => { const s = await tEval("window.__snap && window.__snap()"); return s && s.videosPlaying >= 1 ? s : null; }, 30000, 500);
    const tti = res.filter((r) => r.ok).map((r) => r.ms);
    summary.storm = {
      joined: okN, of: N, failed: res.filter((r) => !r.ok), ttiMs: stats(tti), teacherSees30Ms: teacherSees.ok ? tTeacher : null, teacherGrid: teacherSees.v,
      api: apiWindow(t0), timelines: { enter: stats(bots.slice(0, N).map((b) => b.timeline.enterMs).filter(Boolean)), join: stats(bots.slice(0, N).map((b) => b.timeline.joinMs).filter(Boolean)), wsOpen: stats(bots.slice(0, N).map((b) => b.timeline.wsOpenMs).filter(Boolean)) },
    };
    check(`storm: ${okN}/${N} students in`, okN === N, summary.storm.failed.slice(0, 5));
    check("storm: teacher sees all", teacherSees.ok, { ms: summary.storm.teacherSees30Ms, grid: teacherSees.v });
    await sleep(15000);
    summary.storm.lk = lkList();
    await shot("01-storm-30");
    setPhase("scenarioB");
    const sbA = await Promise.all(SB.map((p) => perfSample(p)));
    const wB = await hold(90, "scenarioB 30 (8 cams)");
    const sbB = await Promise.all(SB.map((p) => perfSample(p)));
    summary.scenarioB = { window: wB, lk: lkList(), grid: await gridInfo(), rtc: await rtcSummary(T), studentBrowsers: SB.map((p, k) => ({ ...perfDelta(sbA[k], sbB[k]), rtc: null })) };
    for (const [k, p] of SB.entries()) summary.scenarioB.studentBrowsers[k].rtc = await rtcSummary(p);
    for (const [k, p] of SB.entries()) await p.shot(`${OUT}/shots/02-student${k + 1}-view.png`).catch(() => {});
    await shot("02-scenarioB");
    saveSummary();
  }

  // ── ЧАСТЬ 8. Активный спикер ────────────────────────────────────────────
  if (PHASES.includes("speaker")) {
    setPhase("speaker");
    // Говорят только настоящие браузеры: публикация из файла (lk) уровень речи не передаёт.
    const ids = [];
    for (const p of SB) ids.push(await sbIdentity(p));
    for (const id of ids) if (id) await teacherApi.req("PATCH", `/lessons/${LID}/participants/${id}/permissions`, { canSpeak: true });
    await sleep(3000);
    const tc = Date.now();
    const samples = [];
    const pageNames = await tEval(`[...document.querySelectorAll('div.grid > div')].map(t => (t.innerText||'').split('\\n').pop().trim())`);
    const sampleSpeaking = async (layoutTag) => {
      const s = await tEval(`(() => { const tiles = [...document.querySelectorAll('div.relative.flex.items-center.justify-center.overflow-hidden')]; const name = (t) => (t.innerText||'').replace('говорит','').trim().split('\\n').pop(); const speaking = tiles.filter(t => t.querySelector('.ring-inset.ring-primary')).map(name); let big = null, area = 0; for (const t of tiles) { const r = t.getBoundingClientRect(); if (r.width*r.height > area) { area = r.width*r.height; big = name(t); } } return { speaking, big }; })()`);
      samples.push({ t: Date.now() - tc, layoutTag, ...s });
    };
    // Цикл 100 с: ученик 1 — 0–15, ученик 2 — 20–35, учитель — 40–55, все трое — 60–75, тишина — 80–100.
    const want = (ct) => ({ s1: ct < 15000 || (ct >= 60000 && ct < 75000), s2: (ct >= 20000 && ct < 35000) || (ct >= 60000 && ct < 75000), t: ct >= 40000 && ct < 75000 });
    // Цикл 100 с: S1 0–15, S7 20–35, учитель 40–55, S14 60–75, все 80–95.
    for (const layoutTag of ["grid", "speaker"]) {
      if (layoutTag === "speaker") {
        await T.click(byLabel("Ещё")); await sleep(500); await T.click(byText("[role=menuitem]", "Вид:")); await sleep(1500);
      }
      const cycleStart = tc + (layoutTag === "grid" ? 0 : 100000);
      while (Date.now() < cycleStart + 100000) {
        const ct = (Date.now() - tc) % 100000;
        const w = want(ct);
        await setMic(w.t);
        if (SB[0]) await sbMic(SB[0], w.s1);
        if (SB[1]) await sbMic(SB[1], w.s2);
        await sampleSpeaking(layoutTag);
        await sleep(500);
      }
    }
    await setMic(false);
    for (const p of SB) await sbMic(p, false);
    await T.click(byLabel("Ещё")); await sleep(500); await T.click(byText("[role=menuitem]", "Вид:")); await sleep(1000);
    const focusChanges = samples.filter((s, k) => s.layoutTag === "speaker" && k > 0 && samples[k - 1].layoutTag === "speaker" && s.big !== samples[k - 1].big).length;
    summary.speaker = { visibleOnPage1: pageNames, samples: samples.length, focusChanges, speakingSeen: [...new Set(samples.flatMap((s) => s.speaking || []))], window: windowStats(tc), trace: samples.filter((_, k) => k % 4 === 0) };
    fs.writeFileSync(`${OUT}/speaker-trace.json`, JSON.stringify(samples, null, 1));
    // Ученики-браузеры уходят: дальше счёт участников точный (учитель + боты).
    for (const p of SB) await p.click(byText("button", "Выйти")).catch(() => {});
    await sleep(3000);
    saveSummary();
  }

  // ── ЧАСТИ 5/6/2. Сетка по числу участников, выходы 30→1 и входы 1→30 (все камеры) ──
  if (PHASES.includes("dynamic")) {
    setPhase("leave-down");
    const counts = new Set([1, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13, 15, 20, 25, 30]);
    const grid = [];
    const perChange = [];
    const measureChange = async (label, fn) => {
      const a = await perfSample(T);
      await fn();
      await sleep(2500);
      const b = await perfSample(T);
      const d = perfDelta(a, b);
      perChange.push({ label, commits: b.commits - a.commits, fnRenders: b.fnRenders - a.fnRenders, videoMounts: d.videoMounts, videoRenders: d.videoRenders, tileMoves: d.tileMoves, gridChanges: d.gridChanges, longTaskMs: d.longTaskMs, mut: b.mut - a.mut });
    };
    let inLesson = active();
    while (inLesson.length > 0) {
      const total = inLesson.length + 1;
      if (counts.has(total)) { await sleep(1500); grid.push({ dir: "down", total, ...(await gridInfo()) }); await shot(`grid-down-${String(total).padStart(2, "0")}`); }
      const b = inLesson[Math.floor(Math.random() * inLesson.length)];
      await measureChange(`leave ${total}→${total - 1}`, () => b.leave());
      await sleep(1000 + Math.random() * 3000);
      inLesson = active();
    }
    grid.push({ dir: "down", total: 1, ...(await gridInfo()) }); await shot("grid-down-01");
    setPhase("join-up");
    // Ступени нагрузки «все камеры» (сценарий A): держим на 5/10/15/20/25/29/30.
    const steps = new Set([1, 5, 10, 15, 20, 25, 29, 30]);
    const stepRows = [];
    for (let k = 0; k < 30; k++) {
      const b = bots[k];
      await measureChange(`join ${k + 1}→${k + 2}`, async () => { const r = await botIn(b, { video: true }); if (!r.ok) log({ kind: "join.fail", text: `s${b.i}`, extra: r }); });
      const total = k + 2;
      if (counts.has(total)) { await sleep(3000); grid.push({ dir: "up", total, ...(await gridInfo()) }); await shot(`grid-up-${String(total).padStart(2, "0")}`); }
      if (steps.has(k + 1)) {
        setPhase(`stepA-${k + 1}`);
        const t0 = Date.now();
        const w = await hold(45, `step 1+${k + 1} all cams`);
        stepRows.push({ students: k + 1, window: w, lk: lkList(), rtc: await rtcSummary(T), api: apiWindow(t0) });
        setPhase("join-up");
      } else {
        await sleep(1500 + Math.random() * 3000);
      }
    }
    summary.dynamic = { grid, perChange, steps: stepRows };
    saveSummary();
  }

  // ── ЧАСТЬ 7. Камеры вкл/выкл при 30 ─────────────────────────────────────
  if (PHASES.includes("cams")) {
    setPhase("cams");
    const t0 = Date.now();
    const ch = [];
    const act = active();
    const toggle = async (list, on) => { const a = await perfSample(T); for (const b of list) b.startMedia({ video: on }); await sleep(8000); const b2 = await perfSample(T); const d = perfDelta(a, b2); ch.push({ action: `${list.length} cams ${on ? "on" : "off"}`, videoMounts: d.videoMounts, videoRenders: d.videoRenders, tileMoves: d.tileMoves, gridChanges: d.gridChanges, commits: b2.commits - a.commits, fnRenders: b2.fnRenders - a.fnRenders, longTaskMs: d.longTaskMs, visible: d.videosVisible, playing: d.videosPlaying }); };
    await toggle(act.slice(0, 5), false);
    await toggle(act.slice(0, 5), true);
    await toggle(act.slice(5, 12), false);
    await toggle(act.slice(5, 9), true);
    const leavers = act.slice(20, 23);
    const a = await perfSample(T); for (const b of leavers) await b.leave(); await sleep(6000);
    for (const b of leavers) await botIn(b, { video: true }); await sleep(8000);
    const b2 = await perfSample(T); const d = perfDelta(a, b2);
    ch.push({ action: "3 leave + return", videoMounts: d.videoMounts, tileMoves: d.tileMoves, gridChanges: d.gridChanges, commits: b2.commits - a.commits });
    for (const b of act.slice(9, 12)) b.startMedia({ video: true });
    summary.cams = { changes: ch, window: windowStats(t0) };
    await shot("03-cams");
    saveSummary();
  }

  // ── ЧАСТЬ 10. Демонстрация экрана при 30 ────────────────────────────────
  if (PHASES.includes("share")) {
    setPhase("share");
    const before = await gridInfo();
    const st = await timedClick("start share", byLabel("Демонстрация"), `document.body.innerText.includes('Вы показываете экран')`, 30000);
    await sleep(5000);
    const during = await tEval(`(() => { const rail = [...document.querySelectorAll('div.flex.w-\\\\[190px\\\\]')][0]; return { railTiles: rail ? rail.children.length : 0, railText: rail ? rail.innerText.slice(-30) : null }; })()`);
    await shot("04-share-30");
    const w = await hold(45, "share at 30");
    const stop = await timedClick("stop share", byLabel("Остановить демонстрацию"), `!document.body.innerText.includes('Вы показываете экран')`, 15000);
    await sleep(3000);
    const after = await gridInfo();
    await shot("05-after-share");
    summary.share = { start: st, during, window: w, stop, gridBefore: before, gridAfter: after, restored: before?.grid === after?.grid && before?.cells === after?.cells };
    check("share: grid restored after stop", summary.share.restored, { before, after });
    saveSummary();
  }

  // ── ЧАСТЬ 11/13. Resize и полноэкранный режим ───────────────────────────
  if (PHASES.includes("resize")) {
    setPhase("resize");
    const sizes = [[1920, 1080], [1440, 900], [1280, 720], [1024, 768]];
    const rows = [];
    for (const [w, h] of sizes) {
      const a = await perfSample(T); await setView(w, h); await sleep(4000); const g = await gridInfo(); const b = await perfSample(T); const d = perfDelta(a, b);
      rows.push({ size: `${w}x${h}`, ...g, longTaskMs: d.longTaskMs, videoMounts: d.videoMounts, fps: d.fps }); await shot(`06-size-${w}x${h}`);
    }
    // Плавный ресайз: широкое → узкое → широкое (20 шагов по 150 мс).
    const a = await perfSample(T);
    for (let k = 0; k <= 20; k++) { const x = k <= 10 ? 1920 - k * 90 : 1020 + (k - 10) * 90; await setView(x, 900); await sleep(150); }
    await sleep(2000);
    const b = await perfSample(T); const d = perfDelta(a, b);
    rows.push({ size: "drag 1920→1020→1920", longTaskMs: d.longTaskMs, longTasks: d.longTasks, videoMounts: d.videoMounts, videoRenders: d.videoRenders, fps: d.fps, gridChanges: d.gridChanges, layoutPerSec: d.layoutPerSec });
    await setView(1440, 900); await sleep(1500);
    const fs1 = await timedClick("fullscreen", byLabel("Ещё"), `!!${byText("[role=menuitem]", "весь экран")}`, 3000);
    await T.click(byText("[role=menuitem]", "весь экран")).catch(() => {}); await sleep(2000);
    const fsState = await tEval("!!document.fullscreenElement");
    await T.click(byLabel("Ещё")); await sleep(400); await T.click(byText("[role=menuitem]", "полноэкранного")).catch(() => {}); await sleep(1500);
    summary.resize = { rows, fullscreen: { opened: fsState, menu: fs1, after: await gridInfo() } };
    saveSummary();
  }

  // ── ЧАСТЬ 12. Боковые панели при 30 ─────────────────────────────────────
  if (PHASES.includes("panels")) {
    setPhase("panels");
    const res = [];
    for (const [label, done] of [["Участники", `!!document.querySelector('aside')`], ["Чат", `!!document.querySelector('[aria-label="Сообщение классу"]')`], ["Материалы урока", `!!${byText("button", "Задание классу")}`]]) {
      const a = await perfSample(T);
      const open = await timedClick(`open ${label}`, byLabel(label), done);
      await sleep(1500);
      const g = await gridInfo();
      await shot(`07-panel-${label}`);
      const close = await timedClick(`close ${label}`, byLabel(label), `!document.querySelector('aside')`);
      await sleep(1500);
      const b = await perfSample(T); const d = perfDelta(a, b);
      res.push({ label, openMs: open.ms, closeMs: close.ms, gridWithPanel: g?.grid, tileW: g?.tileW, videoMounts: d.videoMounts, videoRenders: d.videoRenders, longTaskMs: d.longTaskMs, tileMoves: d.tileMoves });
    }
    summary.panels = res;
    saveSummary();
  }

  // ── ЧАСТЬ 14. Realtime-действия на весь класс ───────────────────────────
  if (PHASES.includes("realtime")) {
    setPhase("realtime");
    const rt = {};
    const deliver = async (name, act, pred) => {
      let t0 = Date.now();
      const t1 = await act();
      if (typeof t1 === "number") t0 = t1;
      await sleep(8000);
      const lat = active().map((b) => { const m = b.firstMsg(pred, t0); return m ? m.t - t0 : null; });
      const got = lat.filter((x) => x !== null);
      const dups = active().map((b) => b.msgs.filter((m) => m.t >= t0 && pred(m)).length).filter((n) => n > 1).length;
      rt[name] = { delivered: got.length, of: active().length, latencyMs: stats(got), botsWithDuplicates: dups };
      log({ kind: "deliver", text: name, extra: rt[name] });
    };
    // Учитель пишет в чат (через интерфейс).
    const text = `Всем: открываем задание ${Date.now() % 10000}`;
    await deliver("teacher chat", async () => {
      await T.click(byLabel("Чат")); await sleep(600);
      await T.click(byLabel("Сообщение классу")); await T.type(text);
      const t = Date.now(); await T.click(byLabel("Отправить")); return t;
    }, (m) => m.type === "chat_message" && m.body === text);
    // Ученик пишет — учитель видит.
    const sText = `Вопрос от ученика ${Date.now() % 10000}`;
    const ts = Date.now(); await active()[3].chat(sText);
    const seen = await waitFor(() => T.eval(`document.body.innerText.includes(${JSON.stringify(sText)})`), 15000, 50);
    rt["student chat → teacher"] = { ok: seen.ok, ms: Date.now() - ts };
    // 10 учеников пишут одновременно.
    const burst = Date.now(); await Promise.all(active().slice(0, 10).map((b, k) => b.chat(`одновременно ${k} ${burst % 10000}`)));
    const all10 = await waitFor(() => T.eval(`[...Array(10).keys()].every(k => document.body.innerText.includes('одновременно ' + k + ' ${burst % 10000}'))`), 20000, 100);
    rt["10 students chat at once → teacher"] = { ok: all10.ok, ms: Date.now() - burst };
    await T.click(byLabel("Чат")); await sleep(500);
    // Режим урока и доска — состояние для всех.
    await deliver("lesson mode", () => teacherApi.req("PATCH", `/lessons/${LID}/mode`, { mode: "discussion" }), (m) => m.type === "lesson_mode" && m.extra === "discussion");
    await deliver("board open (stage)", () => T.click(byLabel("Доска")).then(() => {}), (m) => m.type === "stage_changed" && m.extra === "board");
    await sleep(3000); await shot("08-board-30");
    await deliver("board close (stage)", () => teacherApi.req("PATCH", `/lessons/${LID}/stage`, { stage: "people" }), (m) => m.type === "stage_changed" && m.extra === "people");
    await teacherApi.req("PATCH", `/lessons/${LID}/mode`, { mode: "lecture" });
    summary.realtime = rt;
    saveSummary();
  }

  // ── ЧАСТЬ 15. «Все отвечаем»: массовая сдача ────────────────────────────
  if (PHASES.includes("answers")) {
    setPhase("answers");
    // «Все отвечаем»: ученики отвечают на первые 4 вопроса материала и сдают.
    const mats = await teacherApi.req("GET", "/materials?source=platform");
    const mat = (mats.json?.items || []).find((m) => /Витрина/.test(m.title));
    let actId = null;
    const deliverT0 = Date.now();
    const created = await teacherApi.req("POST", `/lessons/${LID}/activities`, { materialId: mat?.id, revealResults: true });
    actId = created.json?.id;
    await sleep(6000);
    const gotStart = active().filter((b) => b.firstMsg((m) => m.type === "activity_started", deliverT0)).length;
    const respFor = (q) => {
      const it = q.interaction;
      switch (it.type) {
        case "single_choice": return { type: it.type, selectedOptionId: it.options?.[0]?.id ?? null };
        case "multiple_choice": return { type: it.type, selectedOptionIds: it.options?.slice(0, 1).map((o) => o.id) ?? [] };
        case "true_false": return { type: it.type, value: true };
        case "text_input": return { type: it.type, value: "Москва" };
        case "numeric_input": return { type: it.type, value: 42 };
        case "open_answer": return { type: it.type, text: "Развёрнутый ответ ученика.", attachmentIds: [] };
        default: return null;
      }
    };
    const loads = await Promise.all(active().map((b) => b.http.req("GET", `/activities/${actId}/my`)));
    const qs = (loads[0]?.json?.material?.blocks || []).filter((bl) => bl.type === "question" && respFor(bl)).slice(0, 4);
    const t0 = Date.now();
    // Все сохраняют ответы и сдают почти одновременно (разброс 0–1 с).
    const results = await Promise.all(active().map(async (b, k) => {
      await sleep(Math.random() * 1000);
      const my = loads[k]?.json;
      const myQs = (my?.material?.blocks || []).filter((bl) => bl.type === "question" && respFor(bl)).slice(0, 4);
      const saves = await Promise.all(myQs.map((q) => b.http.req("POST", `/activities/${actId}/responses`, { questionId: q.id, response: respFor(q) })));
      const sub = await b.http.req("POST", `/activities/${actId}/submit`);
      // Повторный «Сдать» (двойной клик / повтор после потерянного ответа).
      const sub2 = k % 5 === 0 ? await b.http.req("POST", `/activities/${actId}/submit`) : null;
      return { saves: saves.map((s) => s.status), saveMs: saves.map((s) => s.ms), sub: sub.status, subMs: sub.ms, sub2: sub2?.status, score: sub.json?.score };
    }));
    const tAll = Date.now() - t0;
    await sleep(5000);
    const prog = await teacherApi.req("GET", `/activities/${actId}/progress`);
    const p = prog.json;
    const submittedN = Array.isArray(p?.students) ? p.students.filter((s) => s.submittedAt || s.status === "submitted").length : p?.submittedCount ?? null;
    // Учитель открывает задание на стейдже (прогресс класса) — отзывчивость.
    const open = await timedClick("teacher opens activity stage", byLabel("Материалы урока"), `!!${byText("button", "Задание классу")}`);
    await T.click(byText("button", "Задание классу")); await sleep(800);
    const showBtn = await waitFor(() => T.eval(`!!${byText("button", "Показать классу")}`), 5000);
    if (showBtn.ok) await T.click(byText("button", "Показать классу"));
    await sleep(4000); await shot("09-activity-progress");
    summary.answers = {
      material: mat?.title, activityId: actId, questionsAnswered: qs.length, deliveredActivityStarted: `${gotStart}/${active().length}`,
      saves: { total: results.reduce((s, r) => s + r.saves.length, 0), failed: results.reduce((s, r) => s + r.saves.filter((x) => x !== 200 && x !== 201).length, 0), latency: stats(results.flatMap((r) => r.saveMs)) },
      submits: { ok: results.filter((r) => r.sub === 200 || r.sub === 201).length, failed: results.filter((r) => r.sub !== 200 && r.sub !== 201).map((r) => r.sub), latency: stats(results.map((r) => r.subMs)), repeatSubmit: results.filter((r) => r.sub2).map((r) => r.sub2) },
      wallMs: tAll, teacherProgressStatus: prog.status, submittedPerTeacher: submittedN, progressSample: JSON.stringify(p).slice(0, 400), openStage: open,
    };
    check(`answers: ${summary.answers.submits.ok}/${active().length} submitted`, summary.answers.submits.ok === active().length, summary.answers.submits);
    // Закрыть задание на стейдже учителя.
    await T.click(byText("button", "Свернуть")).catch(() => {}); await sleep(1500);
    await T.click(byLabel("Материалы урока")).catch(() => {}); await sleep(800);
    saveSummary();
  }

  // ── ЧАСТЬ 17. Учитель управляет уроком при 30 ───────────────────────────
  if (PHASES.includes("interact")) {
    setPhase("interact");
    const r = [];
    r.push(await timedClick("mic on", `${byLabel("Включить звук")}`, `!!${byLabel("Микрофон")}`));
    r.push(await timedClick("mic off", `${byLabel("Микрофон")}`, `!!${byLabel("Включить звук")}`));
    r.push(await timedClick("open chat", byLabel("Чат"), `!!document.querySelector('[aria-label="Сообщение классу"]')`));
    r.push(await timedClick("close chat", byLabel("Чат"), `!document.querySelector('aside')`));
    r.push(await timedClick("open materials", byLabel("Материалы урока"), `!!${byText("button", "Задание классу")}`));
    r.push(await timedClick("close materials", byLabel("Материалы урока"), `!document.querySelector('aside')`));
    r.push(await timedClick("open board", byLabel("Доска"), `!!document.querySelector('.excalidraw')`, 20000));
    await sleep(2500);
    r.push(await timedClick("close board", byLabel("Доска"), `!document.querySelector('.excalidraw')`, 10000));
    r.push(await timedClick("open people + mute one", byLabel("Участники"), `!!document.querySelector('aside')`));
    await T.click(byLabel("Участники")); await sleep(500);
    r.push(await timedClick("start share", byLabel("Демонстрация"), `document.body.innerText.includes('Вы показываете экран')`, 30000));
    await sleep(3000);
    r.push(await timedClick("stop share", byLabel("Остановить демонстрацию"), `!document.body.innerText.includes('Вы показываете экран')`, 15000));
    const ev = (await tEval("window.__probe ? window.__probe.events.splice(0) : []")) || [];
    summary.interact = { actions: r, eventTiming: ev };
    saveSummary();
  }

  // ── ЧАСТЬ 4C. Лекция: камеры учеников выкл, демонстрация + материалы ───
  if (PHASES.includes("lecture")) {
    setPhase("lecture");
    for (const b of active()) b.startMedia({ presence: true });
    await sleep(8000);
    await T.click(byLabel("Демонстрация")); await waitFor(() => T.eval(`document.body.innerText.includes('Вы показываете экран')`), 30000);
    const t0 = Date.now();
    await sleep(60000);
    await T.click(byLabel("Остановить демонстрацию")); await sleep(2000);
    await T.click(byLabel("Доска")); await sleep(30000);
    await T.click(byLabel("Доска")); await sleep(2000);
    summary.lecture = { window: windowStats(t0), lk: lkList(), rtc: await rtcSummary(T), grid: await gridInfo() };
    await shot("10-lecture");
    // Обратно к «обычному классу»: 8 камер.
    for (const b of active().slice(0, 8)) b.startMedia({ video: true });
    await sleep(8000);
    saveSummary();
  }

  // ── ЧАСТЬ 16. Массовое переподключение ──────────────────────────────────
  if (PHASES.includes("reconnect")) {
    setPhase("reconnect");
    const cutSec = Number(process.env.CUT_SEC || 20);
    const before = { lk: lkList(), ws: active().filter((b) => b.wsState === "connected").length };
    const wsConnBefore = active().reduce((s, b) => s + b.wsConnects, 0);
    const lkStartsBefore = active().reduce((s, b) => s + b.lkStarts, 0);
    const tCut = Date.now();
    fs.writeFileSync(`${OUT}/ctl.cut`, `${tCut} ${cutSec}\n`);
    await waitFor(() => fs.existsSync(`${OUT}/ctl.cut.done`), (cutSec + 30) * 1000, 500);
    const tUp = Date.now();
    const trace = [];
    let allWs = null, allLk = null, teacherOk = null;
    for (let k = 0; k < 60; k++) {
      const ws = active().filter((b) => b.wsState === "connected").length;
      const lk = lkList();
      const snap = await tEval("window.__snap && window.__snap()");
      const g = await gridInfo();
      trace.push({ s: Math.round((Date.now() - tUp) / 1000), ws, lkActive: lk.active, lkDup: lk.dup, teacherHead: g?.head, playing: snap?.videosPlaying });
      if (allWs === null && ws === active().length) allWs = Date.now() - tUp;
      if (allLk === null && lk.active >= active().length + 1) allLk = Date.now() - tUp;
      if (teacherOk === null && headCount(g) === active().length + 1) teacherOk = Date.now() - tUp;
      if (allWs !== null && allLk !== null && k > 6) break;
      await sleep(3000);
    }
    await shot("11-after-reconnect");
    summary.reconnect = {
      cutSec, before, allWsMs: allWs, allLkMs: allLk, teacherHeadOkMs: teacherOk, trace,
      wsReconnects: active().reduce((s, b) => s + b.wsConnects, 0) - wsConnBefore, lkRestarts: active().reduce((s, b) => s + b.lkStarts, 0) - lkStartsBefore,
      api: apiWindow(tUp), window: windowStats(tCut), lkExitsDuring: "см. events bot.lk.exit",
    };
    check("reconnect: all WS back", allWs !== null, { allWs });
    check("reconnect: all media back", allLk !== null, { allLk, last: trace.at(-1) });
    saveSummary();
  }

  // ── Урок глазами учителя: 25 шагов, время до видимой реакции + скриншоты ──
  if (PHASES.includes("lesson")) {
    setPhase("lesson");
    const steps = [];
    let n = 0;
    const step = async (label, fn) => {
      n += 1;
      const a = await perfSample(T);
      const t0 = Date.now();
      let res = null, err = null;
      try { res = await fn(); } catch (e) { err = String(e).slice(0, 200); }
      const b = await perfSample(T);
      const d = perfDelta(a, b);
      const ev = (b.events || []).map((e) => e.d);
      const row = { n, label, ms: Date.now() - t0, ...(res && typeof res === "object" ? res : {}), err, videoMounts: d.videoMounts, tileMoves: d.tileMoves, longTaskMs: d.longTaskMs, slowestInputMs: ev.length ? Math.max(...ev) : 0 };
      steps.push(row); log({ kind: "lesson", text: `${n}. ${label}`, extra: row });
      await shot(`L${String(n).padStart(2, "0")}`);
      fs.writeFileSync(`${OUT}/lesson.json`, JSON.stringify(steps, null, 1));
    };
    const until = async (expr, ms = 15000) => { const r = await waitFor(() => T.eval(expr), ms, 50); return { visibleMs: r.ok ? r.ms : null }; };
    const toasts = () => T.eval(`[...document.querySelectorAll('[data-sonner-toast]')].map(t => t.innerText.trim())`).catch(() => []);
    await step("Учитель в уроке (до входа учеников)", async () => ({ head: (await gridInfo())?.head }));
    await step("Пригласить → ссылка скопирована", async () => { await T.click(byText("button", "Пригласить")); await sleep(700); return { toasts: await toasts() }; });
    await step("30 участников входят постепенно (камеры у всех)", async () => {
      for (const [k, b] of bots.slice(0, 27).entries()) { await botIn(b, { video: true }); await sleep(1500 + Math.random() * 1500); if (k === 9 && SB[0]) await sbEnter(SB[0]); if (k === 19 && SB[1]) await sbEnter(SB[1]); }
      await sleep(5000); for (const p of SB) await sbMic(p, false);
      const ids = []; for (const p of SB) ids.push(await sbIdentity(p));
      for (const id of ids) if (id) await teacherApi.req("PATCH", `/lessons/${LID}/participants/${id}/permissions`, { canSpeak: true });
      await sleep(3000); return { head: (await gridInfo())?.head };
    });
    await step("Несколько учеников говорят", async () => { if (SB[0]) await sbMic(SB[0], true); if (SB[1]) await sbMic(SB[1], true); await sleep(4000); const g = await tEval(`(() => { const b = [...document.querySelectorAll('button')].find(b => /^Говор/.test((b.innerText||'').trim())); return b ? b.innerText.replace(/\\s+/g,' ') : null; })()`); return { speakerHint: g }; });
    await shot("L04b-speakers");
    if (SB[0]) await sbMic(SB[0], false); if (SB[1]) await sbMic(SB[1], false);
    await step("Открыть чат", async () => { await T.click(byLabel("Чат")); return until(`!!document.querySelector('[aria-label="Сообщение классу"]')`); });
    await step("Открыть участников", async () => { await T.click(byLabel("Участники")); return until(`[...document.querySelectorAll('aside input')].some(i => /Найти участника/.test(i.placeholder))`); });
    await step("Открыть материалы", async () => { await T.click(byLabel("Материалы урока")); return until(`!!${byText("button", "Задание классу")}`); });
    let actId = null;
    await step("Запустить задание (Витрина)", async () => {
      await T.click(byText("button", "Задание классу")); await sleep(800);
      await T.click("document.querySelector('[role=combobox]')"); await sleep(1200);
      await T.click(byText("[role=option]", "Витрина")); await sleep(500);
      const t0 = Date.now(); await T.click(byText("button", "Выдать"));
      const r = await waitFor(() => T.eval(`document.body.innerText.includes('Задание выдано')`), 15000, 50);
      const rows = await teacherApi.req("GET", `/lessons/${LID}/activities`); actId = rows.json?.items?.[0]?.id;
      await sleep(2000);
      return { issuedVisibleMs: r.ok ? Date.now() - t0 : null, studentsGotIt: active().filter((b) => b.firstMsg((m) => m.type === "activity_started", t0)).length };
    });
    await step("Ученики отвечают и почти одновременно сдают", async () => {
      const t0 = Date.now();
      const res = await Promise.all(active().map(async (b) => {
        await sleep(Math.random() * 1500);
        const my = await b.http.req("GET", `/activities/${actId}/my`);
        const qs = (my.json?.material?.blocks || []).filter((bl) => bl.type === "question" && bl.interaction.type === "single_choice").slice(0, 3);
        for (const q of qs) await b.http.req("POST", `/activities/${actId}/responses`, { questionId: q.id, response: { type: "single_choice", selectedOptionId: q.interaction.options[0].id } });
        return (await b.http.req("POST", `/activities/${actId}/submit`)).status;
      }));
      await T.click(byText("button", "Показать классу")).catch(() => {}); await sleep(5000);
      const panel = await tEval(`document.body.innerText.match(/\\d+ ответили/)?.[0] || null`);
      return { submitted: res.filter((s) => s === 200 || s === 201).length, of: res.length, wallMs: Date.now() - t0, teacherPanel: panel };
    });
    await T.click(byText("button", "Свернуть")).catch(() => {}); await sleep(1500);
    const lostBot = active().find((b) => b.i <= 6);
    await step("Ученик теряет интернет (30 с, канал и медиа)", async () => { lostBot.stopMedia(); lostBot.dropWs(30000); await sleep(6000); const g = await tEval(`[...document.querySelectorAll('div.grid > div')].filter(t => /Переподключение/.test(t.innerText||'')).map(t => (t.innerText||'').split('\\n').pop())`); return { reconnectingTiles: g }; });
    await step("Другой ученик выключает камеру", async () => { active()[7].startMedia({ presence: true }); await sleep(5000); return {}; });
    await step("Третий включает камеру", async () => { active()[7].startMedia({ video: true }); await sleep(6000); return {}; });
    await step("Потерявший интернет возвращается", async () => { await sleep(25000); lostBot.startMedia({ video: true }); await sleep(8000); const g = await tEval(`[...document.querySelectorAll('div.grid > div')].filter(t => /Переподключение/.test(t.innerText||'')).length`); return { stillReconnecting: g, head: (await gridInfo())?.head }; });
    await step("Открыть доску", async () => { await T.click(byLabel("Доска")); return until(`!!document.querySelector('.excalidraw canvas')`, 20000); });
    await step("Нарисовать прямоугольник", async () => { await T.key("r", "KeyR", 82); await sleep(300); await T.drag(500, 300, 700, 450); await sleep(1000); return {}; });
    await step("Закрыть доску", async () => { await T.click(byLabel("Доска")); return until(`!document.querySelector('.excalidraw')`); });
    await step("Начать демонстрацию", async () => { await T.click(byLabel("Демонстрация")); return until(`document.body.innerText.includes('Вы показываете экран')`, 30000); });
    await step("Остановить демонстрацию", async () => { await T.click(byLabel("Остановить демонстрацию")); return until(`!document.body.innerText.includes('Вы показываете экран')`); });
    await step("Сменить режим урока (Обсуждение)", async () => { await T.click(byLabel("Ещё")); await sleep(500); await T.click(byText("[role=menuitem]", "Режим урока")); await sleep(500); await T.click(byText("[role=menuitem]", "Обсуждение")); const r = await until(`document.body.innerText.includes('Режим: обсуждение')`); return { ...r, students: active().filter((b) => b.msgs.some((m) => m.type === "lesson_mode" && m.extra === "discussion")).length }; });
    await step("Изменить размер окна 1440→1100→1440", async () => { await setView(1100, 800); await sleep(1500); const g1 = await gridInfo(); await setView(1440, 900); await sleep(1500); return { at1100: g1?.grid }; });
    await step("Ученик обновляет страницу (F5)", async () => { const p = SB[0]; if (!p) return {}; const h0 = headCount(await gridInfo()); await p.reload(); const back = await waitFor(() => p.eval(`!!${byLabel("Чат")}`), 30000); const h1 = headCount(await gridInfo()); return { backMs: back.ok ? back.ms : null, headBefore: h0, headAfter: h1 }; });
    await step("Ученик закрывает вкладку", async () => { const p = SB[1]; if (!p) return {}; const h0 = headCount(await gridInfo()); await p.send("Page.close").catch(() => {}); await sleep(4000); const g4 = await tEval(`document.body.innerText.includes('Переподключение')`); await sleep(14000); return { headBefore: h0, after4sReconnectingShown: g4, headAfter18s: headCount(await gridInfo()) }; });
    await step("Учитель выходит из урока", async () => { await T.click(byText("button", "Выйти")); const r = await waitFor(() => T.eval("location.pathname === '/lessons'"), 10000, 50); return { leftMs: r.ok ? r.ms : null }; });
    summary.lesson = steps; saveSummary();
  }

  // ── Короткий capacity smoke: N участников, все камеры ───────────────────
  if (PHASES.includes("capacity")) {
    setPhase("capacity");
    const cap = {};
    const t0 = Date.now();
    const res = await Promise.all(bots.slice(0, N).map(async (b) => { await sleep(Math.random() * 4000); return { i: b.i, ...(await botIn(b, { video: true })) }; }));
    cap.joined = res.filter((r) => r.ok).length; cap.of = N;
    cap.refused = res.filter((r) => !r.ok).map((r) => r.err?.slice(0, 80));
    cap.tti = stats(res.filter((r) => r.ok).map((r) => r.ms));
    cap.api = apiWindow(t0);
    await sleep(15000);
    cap.lk = lkList();
    const tw = Date.now(); await sleep(60000); cap.window = windowStats(tw); cap.rtc = await rtcSummary(T); cap.grid = await gridInfo();
    // речь учителя (настоящий браузер)
    await setMic(true); await sleep(5000); cap.teacherSpeaking = await tEval(`[...document.querySelectorAll('.ring-inset.ring-primary')].length > 0`); await setMic(false);
    // чат
    const text = `cap ${N} ${Date.now() % 1000}`; await T.click(byLabel("Чат")); await sleep(500); await T.click(byLabel("Сообщение классу")); await T.type(text);
    const tc = Date.now(); await T.click(byLabel("Отправить")); await sleep(5000);
    const lat = active().map((b) => b.firstMsg((m) => m.type === "chat_message" && m.body === text, tc)).filter(Boolean).map((m) => m.t - tc);
    cap.chat = { delivered: lat.length, of: active().length, ...stats(lat) }; await T.click(byLabel("Чат")); await sleep(500);
    // доска
    cap.board = await timedClick("board open", byLabel("Доска"), `!!document.querySelector('.excalidraw canvas')`, 20000); await sleep(3000);
    await timedClick("board close", byLabel("Доска"), `!document.querySelector('.excalidraw')`);
    // камеры
    const ta = await perfSample(T); for (const b of active().slice(0, 5)) b.startMedia({ presence: true }); await sleep(5000); for (const b of active().slice(0, 5)) b.startMedia({ video: true }); await sleep(8000);
    const tb2 = await perfSample(T); const dcam = perfDelta(ta, tb2); cap.cams = { videoMounts: dcam.videoMounts, tileMoves: dcam.tileMoves, longTaskMs: dcam.longTaskMs };
    // демонстрация
    cap.shareStart = await timedClick("share start", byLabel("Демонстрация"), `document.body.innerText.includes('Вы показываете экран')`, 30000); await sleep(8000);
    cap.shareStop = await timedClick("share stop", byLabel("Остановить демонстрацию"), `!document.body.innerText.includes('Вы показываете экран')`);
    // обрыв сети класса 20 с
    fs.writeFileSync(`${OUT}/ctl.cut`, `${Date.now()} 20\n`);
    await waitFor(() => fs.existsSync(`${OUT}/ctl.cut.done`), 60000, 500);
    const tu = Date.now();
    const back = await waitFor(() => { const l = lkList(); return l.active >= active().length + 1 && active().every((b) => b.wsState === "connected") ? l : null; }, 120000, 2000);
    cap.reconnect = { ok: back.ok, ms: back.ok ? Date.now() - tu : null, lk: back.v || lkList(), apiAfter: apiWindow(tu) };
    cap.host = "см. host-by-phase.json (capacity)";
    summary.capacity = cap; saveSummary();
    log({ kind: "capacity", text: `N=${N}`, extra: { joined: cap.joined, refused: cap.refused.length, tti: cap.tti, fps: cap.window.fpsAvg, longTaskPct: cap.window.longTaskPct, chat: cap.chat, reconnect: cap.reconnect.ms } });
  }

  // ── Короткий медиатокен гостя: переподключение после его истечения ──────
  if (PHASES.includes("ttl")) {
    setPhase("ttl");
    const p = SB[0];
    check("ttl: student in", await sbEnter(p));
    const t0 = Date.now();
    const flowing = async () => {
      const a = await rtcSummary(p); await sleep(4000); const b = await rtcSummary(p);
      const pill = await p.eval(`/Восстанавливаем звук|Подключаем звук|Связь прервалась/.test(document.body.innerText)`).catch(() => true);
      return b.bytesIn > a.bytesIn + 20000 && !pill;
    };
    const cut = async (sec) => {
      fs.rmSync(`${OUT}/ctl.cut.done`, { force: true });
      fs.writeFileSync(`${OUT}/ctl.cut`, `${Date.now()} ${sec}\n`);
      await waitFor(() => fs.existsSync(`${OUT}/ctl.cut.done`), (sec + 30) * 1000, 500);
      const tUp = Date.now();
      const back = await waitFor(flowing, 180000, 1000);
      const inRoom = await p.eval(`!!${byLabel("Чат")}`).catch(() => false);
      return { cutSec: sec, mediaBackMs: back.ok ? Date.now() - tUp : null, stillInRoomWithoutF5: inRoom };
    };
    const R = { baseline: await waitFor(flowing, 60000, 1000).then((r) => r.ok) };
    R.cutAt2min = await cut(30);
    const waitUntil = t0 + Number(process.env.TTL_WAIT_MIN || 16) * 60000;
    while (Date.now() < waitUntil) await sleep(10000);
    R.minutesConnected = Math.round((Date.now() - t0) / 60000);
    R.cut30afterExpiry = await cut(30);
    R.cut70afterExpiry = await cut(70);
    const tF5 = Date.now(); await p.reload();
    const back = await waitFor(async () => (await p.eval(`!!${byLabel("Чат")}`).catch(() => false)) && (await flowing()), 120000, 1000);
    R.f5 = { ok: back.ok, ms: back.ok ? Date.now() - tF5 : null };
    summary.ttl = R; saveSummary();
    log({ kind: "ttl", text: "result", extra: R });
  }

  // ── Проверка исправлений гостевого доступа (G-01, G-03, TTL, гранты) ──────
  if (PHASES.includes("sec")) {
    setPhase("sec");
    const R = {};
    const lkRaw = (args) => spawnSync("lk", ["--url", process.env.LK_URL, "--api-key", process.env.LK_KEY, "--api-secret", process.env.LK_SECRET, ...args], { encoding: "utf8", timeout: 15000 });
    const inRoom = (id) => (lkRaw(["room", "participants", "list", `lesson-${LID}`]).stdout || "").includes(id);
    const b0 = bots[0];
    await b0.enter();
    const j = await b0.join();
    const tok = JSON.parse(Buffer.from(j.media.token.split(".")[1], "base64url").toString());
    R.token = { ttlSec: tok.exp - (tok.nbf ?? tok.iat), room: tok.video?.room, sub: tok.sub, grant: tok.video };
    R.roomList = (lkRaw(["room", "list"]).stdout || "").split("\n").filter((l) => l.includes(LID)).join(" | ").slice(0, 300);
    // Выход убирает из LiveKit (клиент «забыл» отключиться — процесс lk живёт).
    b0.startMedia({ presence: true });
    await waitFor(() => inRoom(b0.identity), 15000, 500);
    R.beforeLeaveInLk = inRoom(b0.identity);
    await b0.http.req("POST", `/lessons/${LID}/leave`);
    const gone = await waitFor(() => !inRoom(b0.identity), 15000, 500);
    R.leaveRemovedFromLk = { ok: gone.ok, ms: gone.ms };
    // Подключение к медиа той же личностью в обход /join — вебхук выкидывает.
    b0.startMedia({ presence: true });
    await sleep(2000);
    const kicked = await waitFor(() => !inRoom(b0.identity), 20000, 500);
    R.bypassKicked = { ok: kicked.ok, ms: kicked.ms };
    // Честный возврат через /join — остаётся.
    b0.stopMedia();
    await b0.join();
    b0.startMedia({ presence: true });
    await sleep(8000);
    R.rejoinStays = inRoom(b0.identity);
    b0.stopMedia();
    await b0.leave();
    // Одновременные входы сверх потолка.
    const max = Number(process.env.EXPECT_MAX || 50);
    const rush = bots.slice(1, 1 + max + 10);
    await Promise.all(rush.map((b) => b.enter()));
    const statuses = await Promise.all(rush.map((b) => b.http.req("POST", `/lessons/${LID}/join`).then((r) => ({ s: r.status, code: r.json?.error }))));
    R.rush = { attempts: rush.length, ok: statuses.filter((x) => x.s === 200).length, full: statuses.filter((x) => x.code === "lesson_full").length, other: statuses.filter((x) => x.s !== 200 && x.code !== "lesson_full").map((x) => x.s) };
    await Promise.all(rush.map((b) => b.http.req("POST", `/lessons/${LID}/leave`)));
    summary.sec = R; saveSummary();
    log({ kind: "sec", text: "result", extra: R });
  }

  // ── Выдача права говорить: включается ли микрофон сам? ─────────────────
  if (PHASES.includes("grant")) {
    setPhase("grant");
    const p = SB[0];
    check("grant: student in", await sbEnter(p));
    await sleep(20000);
    const id = await sbIdentity(p);
    const st = async (label) => {
      const btn = await p.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Микрофон|Включить звук|поднимите руку/.test(x.getAttribute('aria-label')||'')); return b ? { label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed') } : null; })()`).catch(() => null);
      const lk = spawnSync("lk", ["--url", process.env.LK_URL, "--api-key", process.env.LK_KEY, "--api-secret", process.env.LK_SECRET, "room", "participants", "get", "--room", `lesson-${LID}`, id], { encoding: "utf8", timeout: 15000 });
      const audioTracks = ((lk.stdout || "").match(/"type":\s*"?AUDIO|type: AUDIO|AUDIO/g) || []).length;
      const r = { label, btn, audioTracks, lkOut: (lk.stdout || lk.stderr || "").slice(0, 300).replace(/\s+/g, " ") };
      log({ kind: "grant", text: label, extra: r });
      return r;
    };
    const rows = [await st("before grant")];
    await teacherApi.req("PATCH", `/lessons/${LID}/participants/${id}/permissions`, { canSpeak: true });
    await sleep(5000); rows.push(await st("5 s after grant"));
    await sleep(15000); rows.push(await st("20 s after grant"));
    summary.grant = rows; saveSummary();
  }

  // ── C-03 / C-04: говорящий вне страницы и короткий разрыв канала урока ───
  if (PHASES.includes("ux2")) {
    setPhase("ux2-join");
    // Порядок входа задаёт страницы: учитель, живой A (стр. 1), 12 ботов,
    // живой B (стр. 2), 8 ботов, живой C (стр. 3), ещё 6 ботов = 30.
    const order = [SB[0], ...bots.slice(0, 12), SB[1], ...bots.slice(12, 20), SB[2], ...bots.slice(20, 26)];
    const camOn = new Set([2, 4, 6, 9, 13, 15, 18, 22]);
    for (const x of order) {
      if (!x) continue;
      if (x instanceof Bot) await botIn(x, { video: camOn.has(x.i) }); else await sbEnter(x);
      await sleep(400);
    }
    await sleep(6000);
    const ids = [];
    for (const p of SB) ids.push(await sbIdentity(p));
    for (const id of ids) if (id) await teacherApi.req("PATCH", `/lessons/${LID}/participants/${id}/permissions`, { canSpeak: true });
    // Урок с «ученики могут говорить»: живые входят с включённым микрофоном —
    // выключаем, говорят только по сценарию.
    for (const p of SB) await sbMic(p, false);
    await sleep(4000);
    const g0 = await gridInfo();
    check("ux2: 30 in lesson, paged", headCount(g0) === 30 && /показаны/.test(g0?.page || ""), g0);
    const grid = () => tEval(`(() => {
      const g = [...document.querySelectorAll('div.grid')].find((d) => /repeat\\(/.test(d.style.gridTemplateColumns || ''));
      const bar = [...document.querySelectorAll('button')].find(b => /^Говор(ит|ят):/.test((b.innerText||'').trim()));
      const more = [...document.querySelectorAll('button')].find(b => /^\\+\\d+/.test((b.innerText||'').trim()));
      const tiles = g ? [...g.children].filter(t => !t.matches('button')).map(t => { const r = t.getBoundingClientRect(); return { name: (t.innerText||'').replace('говорит','').replace('Переподключение…','').trim().split('\\n').pop(), speaking: !!t.querySelector('.ring-inset.ring-primary'), reconnecting: /Переподключение/.test(t.innerText||''), x: Math.round(r.x), y: Math.round(r.y) }; }) : [];
      const page = [...document.querySelectorAll('span')].find(s => /показаны/.test(s.textContent||''));
      return { chip: bar ? bar.innerText.replace(/\\s+/g,' ').trim() : null, more: more ? more.innerText.replace(/\\s+/g,' ').trim() : null, moreRing: more ? more.className.includes('ring-primary') : false, tiles, page: page ? page.textContent : null, head: [...document.querySelectorAll('header span')].map(s => s.textContent).find(t => /участник/.test(t||'')) };
    })()`);
    const say = async (who, on) => { for (const [k, p] of SB.entries()) if (who.includes("ABC"[k])) await sbMic(p, on); };
    const watch = async (label, ms) => { const out = []; const t0 = Date.now(); while (Date.now() - t0 < ms) { const g = await grid(); out.push({ t: Date.now() - t0, chip: g?.chip, more: g?.more, moreRing: g?.moreRing, speaking: (g?.tiles || []).filter(t => t.speaking).map(t => t.name), pos: (g?.tiles || []).map(t => t.name + '@' + t.x + ',' + t.y).join('|') }); await sleep(250); } const chipChanges = out.filter((o, k) => k > 0 && o.chip !== out[k - 1].chip).length; const posChanges = out.filter((o, k) => k > 0 && o.pos !== out[k - 1].pos).length; const r = { label, samples: out.length, chipChanges, posChanges, chips: [...new Set(out.map(o => o.chip))], more: [...new Set(out.map(o => o.more + (o.moreRing ? ' [ring]' : '')))], speaking: [...new Set(out.flatMap(o => o.speaking))] }; log({ kind: "c03", text: label, extra: r }); return { ...r, trace: out }; };
    setPhase("c03");
    const c03 = [];
    await sleep(2000);
    say("A", true); c03.push(await watch("1 page-1 student speaks", 8000)); await say("A", false); await sleep(3500);
    say("B", true); c03.push(await watch("2 page-2 student speaks", 8000)); await shot("c03-page2-speaking"); await say("B", false);
    c03.push(await watch("5 speaker stops (hold)", 4000));
    say("C", true); c03.push(await watch("3 page-3 student speaks", 8000));
    say("B", true); c03.push(await watch("4 B and C together", 8000)); await say("B", false); await say("C", false); await sleep(3500);
    // Быстрые переключения: B 1 с, пауза 0,5 с, C 1 с, B 1 с, A 1 с.
    const fast = (async () => { for (const w of ["B", "C", "B", "A", "C", "B"]) { await say(w, true); await sleep(1000); await say(w, false); await sleep(500); } })();
    c03.push(await watch("6 fast speaker switching", 10000)); await fast; await sleep(3000);
    // Ручное листание учителем.
    await T.click(byLabel("Следующие участники")); await sleep(1500);
    say("B", true); c03.push(await watch("7a teacher on page 2, page-2 student speaks", 5000));
    say("C", true); c03.push(await watch("7b teacher on page 2, page-3 student speaks", 5000)); await say("B", false); await say("C", false); await sleep(3000);
    await T.click(byLabel("Следующие участники")); await sleep(1500);
    say("A", true); c03.push(await watch("7c teacher on page 3, page-1 student speaks", 5000));
    const chipBtn = `[...document.querySelectorAll('button')].find(b => /^Говор(ит|ят):/.test((b.innerText||'').trim()))`;
    await T.click(chipBtn); await sleep(1200);
    const afterClick = await grid();
    c03.push({ label: "8 click chip → page with speaker", page: afterClick?.page, chip: afterClick?.chip, speakingTiles: (afterClick?.tiles || []).filter(t => t.speaking).map(t => t.name) });
    log({ kind: "c03", text: "8 click chip", extra: c03.at(-1) });
    await say("A", false); await sleep(1500);
    await T.click(byLabel("Предыдущие участники")).catch(() => {}); await sleep(800); await T.click(byLabel("Предыдущие участники")).catch(() => {}); await sleep(1500);
    fs.writeFileSync(`${OUT}/c03.json`, JSON.stringify(c03, null, 1));
    summary.c03 = c03.map(({ trace, ...r }) => r);
    await shot("c03-end");

    setPhase("c04");
    const c04 = [];
    const firstPageBot = bots.slice(0, 12).find((b) => !b.left);
    const nameOf = (b) => b.name;
    const tileOf = async (name) => { const g = await grid(); const t = (g?.tiles || []).find((x) => x.name === name); return { present: !!t, reconnecting: !!t?.reconnecting, pos: t ? `${t.x},${t.y}` : null, head: headCount({ head: g?.head }), all: (g?.tiles || []).map(x => x.name + '@' + x.x + ',' + x.y).join('|') }; };
    const observe = async (label, b, action, ms) => {
      const before = await tileOf(nameOf(b));
      const t0 = Date.now(); await action();
      const tr = [];
      while (Date.now() - t0 < ms) { const s = await tileOf(nameOf(b)); tr.push({ t: Date.now() - t0, present: s.present, reconnecting: s.reconnecting, head: s.head, moved: s.all !== before.all }); await sleep(250); }
      const firstHidden = tr.find((x) => !x.present)?.t ?? null;
      const firstBadge = tr.find((x) => x.reconnecting)?.t ?? null;
      const neighbourMoves = tr.filter((x, k) => k > 0 && x.moved !== tr[k - 1].moved).length;
      const r = { label, firstBadgeMs: firstBadge, firstHiddenMs: firstHidden, endPresent: tr.at(-1)?.present, endReconnecting: tr.at(-1)?.reconnecting, headMin: Math.min(...tr.map((x) => x.head)), headEnd: tr.at(-1)?.head, layoutChanged: neighbourMoves, samples: tr.length };
      c04.push(r); log({ kind: "c04", text: label, extra: r });
      return r;
    };
    await observe("ws drop 1.5 s", firstPageBot, () => firstPageBot.dropWs(1500), 6000);
    await observe("ws drop 5 s", firstPageBot, () => firstPageBot.dropWs(5000), 10000);
    await observe("ws drop 10 s", firstPageBot, () => firstPageBot.dropWs(10000), 15000);
    await observe("ws drop 20 s (> grace)", firstPageBot, () => firstPageBot.dropWs(20000), 26000);
    await sleep(3000);
    // Долгий обрыв: канал и медиа 60 с, потом возврат.
    const longBot = bots.slice(0, 12).filter((b) => !b.left)[2];
    await observe("long outage 60 s (ws + media) and return", longBot, async () => { longBot.stopMedia(); longBot.dropWs(60000); setTimeout(() => longBot.startMedia({ video: camOn.has(longBot.i) }), 60000); }, 70000);
    // Настоящий выход.
    const leaver = bots.slice(0, 12).filter((b) => !b.left)[4];
    await observe("real leave", leaver, () => leaver.leave(), 5000);
    await sleep(2000);
    // F5 у живого ученика B и закрытие вкладки у C (их плиток на 1-й странице нет — смотрим шапку и список).
    const headNow = async () => headCount(await gridInfo());
    const h0 = await headNow();
    const tF5 = Date.now(); await SB[1].reload();
    const f5 = []; while (Date.now() - tF5 < 15000) { f5.push({ t: Date.now() - tF5, head: await headNow() }); await sleep(500); }
    c04.push({ label: "student F5 (header count)", before: h0, min: Math.min(...f5.map((x) => x.head)), end: f5.at(-1).head, back: await SB[1].eval(`!!${byLabel("Чат")}`).catch(() => false) });
    log({ kind: "c04", text: "student F5", extra: c04.at(-1) });
    const tClose = Date.now(); await SB[2].send("Page.close").catch(() => {});
    const cl = []; while (Date.now() - tClose < 25000) { cl.push({ t: Date.now() - tClose, head: await headNow() }); await sleep(500); }
    const dropAt = cl.find((x) => x.head < cl[0].head)?.t ?? null;
    c04.push({ label: "student closes tab (header count)", before: cl[0].head, droppedAtMs: dropAt, end: cl.at(-1).head });
    log({ kind: "c04", text: "student closes tab", extra: c04.at(-1) });
    fs.writeFileSync(`${OUT}/c04.json`, JSON.stringify(c04, null, 1));
    summary.c04 = c04;
    await shot("c04-end");
    saveSummary();
  }

  // ── C-09: heap snapshot после серии входов/выходов участников ───────────
  if (PHASES.includes("snap")) {
    setPhase("snap");
    const takeSnap = async (file) => {
      await T.send("HeapProfiler.enable");
      await T.send("HeapProfiler.collectGarbage"); await sleep(500); await T.send("HeapProfiler.collectGarbage");
      const ws = fs.createWriteStream(file);
      const prev = tb.listeners.get(T.sessionId);
      tb.listeners.set(T.sessionId, (m, p) => { if (m === "HeapProfiler.addHeapSnapshotChunk") ws.write(p.chunk); else prev?.(m, p); });
      await T.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, captureNumericValue: false }, 300000);
      tb.listeners.set(T.sessionId, prev);
      await new Promise((r) => ws.end(r));
    };
    const reps = Number(process.env.SNAP_REPS || 12);
    if (process.env.SNAP_ACTION === "board") {
      await takeSnap(`${OUT}/before-board.heapsnapshot`);
      for (let k = 0; k < reps; k++) { await T.click(byLabel("Доска")); await waitFor(() => T.eval("!!document.querySelector('.excalidraw')"), 20000); await sleep(3000); await T.click(byLabel("Доска")); await sleep(3000); }
    } else {
      for (let k = 0; k < reps; k++) { const b = active()[k % active().length]; await b.leave(); await sleep(3000); await botIn(b, { video: true }); await sleep(4000); }
    }
    await sleep(3000);
    await takeSnap(`${OUT}/after-churn.heapsnapshot`);
    log({ kind: "snap", text: "taken" });
  }

  // ── C-09: какое действие копит отсоединённые DOM-узлы и слушатели ─────────
  if (PHASES.includes("leak")) {
    setPhase("leak");
    const counters = async () => {
      await T.send("HeapProfiler.collectGarbage").catch(() => {});
      await sleep(600);
      await T.send("HeapProfiler.collectGarbage").catch(() => {});
      const d = await T.send("Memory.getDOMCounters").catch(() => ({}));
      const m = await T.send("Performance.getMetrics").catch(() => ({ metrics: [] }));
      const pm = Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
      const live = await tEval("document.getElementsByTagName('*').length");
      return { nodes: d.nodes, listeners: d.jsEventListeners, docs: d.documents, heapMB: +((pm.JSHeapUsedSize || 0) / 1048576).toFixed(2), live };
    };
    const rows = [];
    const series = async (name, reps, once) => {
      await sleep(1500);
      const a = await counters();
      for (let k = 0; k < reps; k++) { await once(k); }
      await sleep(2500);
      const b = await counters();
      const row = { name, reps, dNodes: b.nodes - a.nodes, dListeners: b.listeners - a.listeners, dHeapMB: +(b.heapMB - a.heapMB).toFixed(2), dLive: b.live - a.live, perRepNodes: +((b.nodes - a.nodes) / reps).toFixed(1), perRepListeners: +((b.listeners - a.listeners) / reps).toFixed(1), after: b };
      rows.push(row);
      log({ kind: "leak", text: name, extra: row });
      fs.writeFileSync(`${OUT}/leak.json`, JSON.stringify(rows, null, 1));
    };
    const toggle = async (label, waitMs = 1200) => { await T.click(byLabel(label)); await sleep(waitMs); await T.click(byLabel(label)); await sleep(waitMs); };
    if (process.env.LEAK_MODE === "plateau") {
      const boardOnce = async () => { await T.click(byLabel("Доска")); await waitFor(() => T.eval("!!document.querySelector('.excalidraw')"), 20000); await sleep(3000); await T.click(byLabel("Доска")); await sleep(3000); };
      const churnOnce = async (k) => { const b = active()[k % active().length]; await b.leave(); await sleep(3000); await botIn(b, { video: true }); await sleep(4000); };
      await series("board warmup", 1, boardOnce);
      await series("board ×5 (1)", 5, boardOnce);
      await series("board ×5 (2)", 5, boardOnce);
      await series("leave/rejoin ×8 (1)", 8, churnOnce);
      await series("leave/rejoin ×8 (2)", 8, churnOnce);
      await series("leave/rejoin ×8 (3)", 8, churnOnce);
      await series("screen share once", 1, async () => { await T.click(byLabel("Демонстрация")); await waitFor(() => T.eval(`document.body.innerText.includes('Вы показываете экран')`), 20000); await sleep(3000); await T.click(byLabel("Остановить демонстрацию")); await sleep(3000); });
      summary.leak = rows; saveSummary();
    } else {
    await series("idle 120s", 1, async () => { await sleep(120000); });
    await series("panel Участники", 10, () => toggle("Участники"));
    await series("panel Чат", 10, () => toggle("Чат"));
    await series("panel Материалы", 10, () => toggle("Материалы урока"));
    await series("layout grid↔speaker", 8, async () => { for (let z = 0; z < 2; z++) { await T.click(byLabel("Ещё")); await sleep(500); await T.click(byText("[role=menuitem]", "Вид:")); await sleep(1500); } });
    await series("teacher mic on/off", 10, async () => { await setMic(true); await sleep(1000); await setMic(false); await sleep(1000); });
    await series("bot camera off/on", 10, async (k) => { const b = active()[k % active().length]; b.startMedia({ presence: true }); await sleep(3000); b.startMedia({ video: true }); await sleep(4000); });
    await series("bot leave/rejoin", 8, async (k) => { const b = active()[k % active().length]; await b.leave(); await sleep(3000); await botIn(b, { video: true }); await sleep(4000); });
    await series("chat 40 msgs (closed)", 40, (k) => active()[k % active().length].chat(`leak ${k}`));
    await series("board open/close", 6, async () => { await T.click(byLabel("Доска")); await waitFor(() => T.eval("!!document.querySelector('.excalidraw')"), 20000); await sleep(3000); await T.click(byLabel("Доска")); await sleep(3000); });
    await series("screen share start/stop", 6, async () => { await T.click(byLabel("Демонстрация")); await waitFor(() => T.eval(`document.body.innerText.includes('Вы показываете экран')`), 20000); await sleep(3000); await T.click(byLabel("Остановить демонстрацию")); await sleep(3000); });
    await series("idle 120s (end)", 1, async () => { await sleep(120000); });
    summary.leak = rows;
    saveSummary();
    }
  }

  // ── ЧАСТЬ 18. Долгий урок с жизнью класса ───────────────────────────────
  if (SOAK_MIN > 0) {
    setPhase("soak");
    const t0 = Date.now();
    const mem = [];
    // Речь в долгом уроке — микрофон учителя (настоящий браузер) по очереди с тишиной.
    let k = 0;
    while (Date.now() - t0 < SOAK_MIN * 60000) {
      k++;
      const r = Math.random();
      const pool = active();
      try {
        if (r < 0.15 && pool.length > 20) { const b = pool[Math.floor(Math.random() * pool.length)]; await b.leave(); setTimeout(() => botIn(b, { video: Math.random() < 0.4 }), 20000 + Math.random() * 40000); }
        else if (r < 0.4) { const b = pool[Math.floor(Math.random() * pool.length)]; if (![1, 7, 14].includes(b.i)) b.startMedia({ video: !b.lkWanted?.video }); }
        else if (r < 0.55) await pool[Math.floor(Math.random() * pool.length)]?.chat(`сообщение ${k}`);
        else if (r < 0.7) { const lbl = ["Чат", "Участники", "Материалы урока"][k % 3]; await T.click(byLabel(lbl)); await sleep(2000); await T.click(byLabel(lbl)); }
        else if (r < 0.78) { await T.click(byLabel("Доска")); await sleep(8000); await T.click(byLabel("Доска")); }
        else if (r < 0.83) { await T.click(byLabel("Демонстрация")); await sleep(15000); await T.click(byLabel("Остановить демонстрацию")).catch(() => {}); }
        else if (r < 0.86) { await setMic(true); await sleep(10000); await setMic(false); }
        else if (r < 0.9) await teacherApi.req("PATCH", `/lessons/${LID}/mode`, { mode: ["lecture", "discussion", "assignment"][k % 3] });
      } catch (e) { log({ kind: "soak.err", text: String(e).slice(0, 200) }); }
      // Срез памяти раз в минуту.
      const min = Math.floor((Date.now() - t0) / 60000);
      if (!mem.length || mem.at(-1).min !== min) {
        await T.send("HeapProfiler.collectGarbage").catch(() => {});
        await sleep(1000);
        const s = await perfSample(T);
        mem.push({ min, heapMB: +(s.cdp.heapUsed / 1048576).toFixed(1), nodes: s.cdp.nodes, listeners: s.cdp.listeners, dom: s.dom, videos: s.videos, students: active().length, ws: active().filter((b) => b.wsState === "connected").length });
        log({ kind: "soak.mem", text: `min ${min}`, extra: mem.at(-1) });
        fs.writeFileSync(`${OUT}/soak-mem.json`, JSON.stringify(mem, null, 1));
      }
      await sleep(15000 + Math.random() * 20000);
    }
    summary.soak = { minutes: SOAK_MIN, mem, window: windowStats(t0) };
    saveSummary();
  }
} catch (e) {
  log({ kind: "ERROR", text: String(e?.stack || e).slice(0, 1500) });
} finally {
  stopSampler = true; stopRtc = true;
  summary.apiAll = apiWindow(0);
  summary.checks = checks;
  saveSummary();
  fs.writeFileSync(`${OUT}/perf.json`, JSON.stringify(perfLog));
  fs.writeFileSync(`${OUT}/api.json`, JSON.stringify(api));
  for (const b of bots) if (!b.left) await b.leave().catch(() => {});
  await sleep(2000);
  console.log(`DONE ${checks.filter((c) => c.ok).length}/${checks.length}`);
  process.exit(0);
}
