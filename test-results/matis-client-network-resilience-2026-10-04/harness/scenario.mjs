// Сценарии network-chaos. SUITE=matrix|transitions|long|turn|smoke
// matrix: каждый профиль сети на ОБА браузера → полный раунд действий → NORMAL → проверка восстановления.
// transitions: сценарии A–H (меняется сеть ученика; учитель на NORMAL).
// long: циклы NORMAL/BAD_4G/3G/BAD_3G/NORMAL по 5 мин (LONG_MIN), действия раз в минуту.
// turn: UDP закрыт / UDP+ICE-TCP закрыты / прямой UDP закрыт → какой путь выбран, обрыв 15 с.
import * as L from "./lib.mjs";
const { sleep, byText, byLabel, check, log, mark, waitFor, flow, hears, sees } = L;

const SUITE = process.env.SUITE || "smoke";
const ROUNDS = {}; // имя → результат
let T, S;

// ── подготовка урока ──
async function setup() {
  ({ T, S } = await L.openBrowsers());
  L.startSampler();
  await L.setProfile("both", "NORMAL");
  const lg = await L.loginTeacher();
  check("setup: teacher login", lg.ok, { ms: lg.ms });
  await T.goto(`${L.ORIGIN}/lessons/${L.LID}/room`);
  check("setup: teacher join", await L.passDeviceCheck(T, true));
  check("setup: guest enter", await L.guestEnter());
  check("setup: student join", await L.passDeviceCheck(S, true));
  await sleep(2500);
  await L.setCtl(S, L.CAM, true); await L.setCtl(S, L.MIC, true);
  await L.setCtl(T, L.CAM, true); await L.setCtl(T, L.MIC, true);
  await ensureActivity();
  // Тот же аккаунт учителя мог зайти с другого устройства (так было 2026-10-04 в 12:59) —
  // тогда здесь диалог «Продолжить здесь»: возвращаем медиа в этот браузер.
  for (const p of [T, S]) if (await p.eval(`!!${byText("button", "Продолжить здесь")}`)) { log({ who: p.name, kind: "info", text: "media taken over → Продолжить здесь" }); await p.click(byText("button", "Продолжить здесь")); await sleep(4000); await L.setCtl(p, L.CAM, true); await L.setCtl(p, L.MIC, true); }
  const m = await waitFor(async () => { const r = await L.mediaBoth(); return L.allMedia(r) ? r : null; }, 45000, 1000);
  check("setup: two-way audio+video", m.ok, m.v ? undefined : await L.mediaBoth());
  // ученик: задание с экрана убираем — стейдж «люди», чтобы раунды начинались одинаково
  await L.shot("00-setup");
}

/** Задание урока должно быть выдано (выдаётся учителем через UI один раз). */
async function ensureActivity() {
  const rows = await L.sql(`select id from activities where lesson_id='${L.LID}' order by created_at desc limit 1`);
  if (rows.length) { log({ kind: "info", text: `activity ${rows[0]}` }); return rows[0]; }
  await L.openDrawer(T, "Материалы урока");
  await T.click(byText("button", "Задание классу")); await sleep(1500);
  await T.click("document.querySelector('[role=combobox]')"); await sleep(1500);
  await T.click(byText("[role=option]", "Витрина")); await sleep(500);
  await T.click(byText("button", "Выдать")); await sleep(4000);
  await T.click(byLabel("Материалы урока"));
  return (await L.sql(`select id from activities where lesson_id='${L.LID}' order by created_at desc limit 1`))[0];
}

// ── отдельные проверки (каждая возвращает {ok, ms, ...}) ──
const T_OUT = (base) => base; // таймауты одинаковы для всех профилей — сравнимость
async function mediaCheck(label, timeoutMs = T_OUT(30000)) {
  const r = await waitFor(async () => { const m = await L.mediaBoth(); return L.audioBoth(m) ? m : null; }, timeoutMs, 1000);
  const m = r.v || (await L.mediaBoth());
  return { ok: r.ok, ms: r.ok ? r.ms : null, audioT2S: m.studentHearsTeacher, audioS2T: m.teacherHearsStudent, videoT2S: m.studentSeesTeacher, videoS2T: m.teacherSeesStudent,
    inKbps: { student: L.lastSample.student?.inb?.map((x) => `${x.kind}:${x.kbps}`).join(" "), teacher: L.lastSample.teacher?.inb?.map((x) => `${x.kind}:${x.kbps}`).join(" ") } };
}
async function toggleCam(p, other, timeoutMs = 40000) {
  await L.setCtl(p, L.CAM, false); await sleep(2500);
  const t0 = Date.now();
  await L.setCtl(p, L.CAM, true);
  const r = await waitFor(async () => sees(await flow(other, 2000)), timeoutMs, 500);
  return { ok: r.ok, ms: r.ok ? Date.now() - t0 : null, uiOn: await L.ctlState(p, L.CAM) };
}
async function toggleMic(p, other, timeoutMs = 40000) {
  await L.setCtl(p, L.MIC, false); await sleep(2500);
  const t0 = Date.now();
  await L.setCtl(p, L.MIC, true);
  const r = await waitFor(async () => hears(await flow(other, 2000)), timeoutMs, 500);
  return { ok: r.ok, ms: r.ok ? Date.now() - t0 : null, uiOn: await L.ctlState(p, L.MIC) };
}
async function screenShare(timeoutMs = 45000) {
  const t0 = Date.now();
  await L.setCtl(T, L.SHARE, true);
  const r = await waitFor(async () => (await flow(S, 2000)).remoteScreen.length > 0, timeoutMs, 500);
  const res = (await flow(S, 1500).catch(() => ({ remoteScreen: [] }))).remoteScreen;
  const startMs = r.ok ? Date.now() - t0 : null;
  await sleep(3000);
  const t1 = Date.now();
  await L.setCtl(T, L.SHARE, false);
  const r2 = await waitFor(async () => (await flow(S, 1500)).remoteScreen.length === 0, 30000, 500);
  return { ok: r.ok && r2.ok, startMs, stopMs: r2.ok ? Date.now() - t1 : null, res };
}
async function board(k) {
  await L.closeDrawers(T); await L.closeDrawers(S);
  await S.click(byLabel("Свернуть задание")).catch(() => {}); // ученик не должен «сидеть» в задании
  await sleep(300);
  const t0 = Date.now();
  const isOn = async () => (await T.eval(`(() => { const b=${byLabel("Доска")}; return b && b.getAttribute('aria-pressed'); })()`)) === "true";
  if (!(await isOn())) await L.press(T, "Доска");
  const vis = await waitFor(() => S.eval("!!document.querySelector('.excalidraw canvas')"), 45000);
  const openMs = vis.ok ? Date.now() - t0 : null;
  await sleep(2000);
  const inkS0 = await L.boardInk(S);
  const inkTpre = await L.boardInk(T);
  await L.drawRect(T, k);
  await sleep(500);
  const localDrawn = (await L.boardInk(T)) !== inkTpre;
  const t1 = Date.now();
  const synced = await waitFor(async () => { const v = await L.boardInk(S); return v != null && inkS0 != null && v !== inkS0; }, 30000, 500);
  // ученик рисует (canDraw в уроке включено)
  const inkT0 = await L.boardInk(T);
  await L.drawRect(S, k + 3);
  const t2 = Date.now();
  const syncedBack = await waitFor(async () => { const v = await L.boardInk(T); return v != null && inkT0 != null && v !== inkT0; }, 30000, 500);
  await L.press(T, "Доска");
  await waitFor(() => S.eval("!document.querySelector('.excalidraw canvas')"), 30000);
  return { ok: vis.ok && synced.ok, localDrawn, openMs, t2sMs: synced.ok ? Date.now() - t1 : null, s2tOk: syncedBack.ok, s2tMs: syncedBack.ok ? Date.now() - t2 : null };
}
let answered = new Set();
async function answer(tag) {
  try { return await answerInner(tag); } finally { await S.click(byLabel("Свернуть задание")).catch(() => {}); await sleep(500); }
}
async function answerInner(tag) {
  // ученик открывает задание (материал 139 вопросов) и отвечает на один вопрос с выбором
  const t0 = Date.now();
  const onStage = async () => S.eval("!!document.querySelector('input[type=radio][name^=\"q-\"]') || document.body.innerText.includes('ответы сохраняются')");
  if (!(await onStage())) {
    await L.openDrawer(S, "Материалы урока");
    await S.click(byText("button", "Задание"));
  }
  const vis = await waitFor(onStage, 60000, 500);
  const openMs = vis.ok ? Date.now() - t0 : null;
  if (!vis.ok) return { ok: false, why: "activity not visible", openMs };
  // ищем страницу с неотвеченным вопросом-выбором
  let target = null;
  for (let i = 0; i < 20 && !target; i++) {
    target = await S.eval(`(() => { const done = ${JSON.stringify([...answered])}; const r = [...document.querySelectorAll('input[type=radio][name^="q-"]')].filter(x => x.getBoundingClientRect().width > 0 || x.closest('label')?.getBoundingClientRect().width > 0); const names = [...new Set(r.map(x => x.name))].filter(n => !done.includes(n)); if (!names.length) return null; const n = names[0]; const opts = r.filter(x => x.name === n); const o = opts[Math.floor(Math.random() * opts.length)]; return { name: n, value: o.value }; })()`);
    if (!target) { await S.click(byLabel("Следующая страница")); await sleep(1500); }
  }
  if (!target) return { ok: false, why: "no unanswered question", openMs };
  answered.add(target.name);
  let ok = false;
  for (let i = 0; i < 10 && !ok; i++) {
    ok = await S.click(`([...document.querySelectorAll('input[name=${JSON.stringify(target.name)}][value=${JSON.stringify(target.value)}]')].map(x => x.closest('label')).find(l => l && l.getBoundingClientRect().width > 0) || null)`).catch(() => false);
    if (!ok) await sleep(1500);
  }
  if (!ok) return { ok: false, why: "radio vanished (re-render)", openMs };
  const t1 = Date.now();
  const qid = target.name.slice(2);
  const sid = ((await L.lkParticipants()).list || []).find((x) => (x.name || "").startsWith("E2E Ученик"))?.identity || L.lastSample.livekit?.list?.find((x) => (x.name || "").startsWith("E2E Ученик"))?.identity;
  const saved = await waitFor(async () => Number((await L.sql(`select count(*) from responses where lesson_id='${L.LID}' and question_id='${qid}' and participant_id in (select id from lesson_participants where guest_id::text='${sid}' or user_id::text='${sid}') and response::text like '%${target.value}%'`))[0]) > 0, 60000, 1000);
  const uiStatus = await S.eval("(() => { const t = document.body.innerText; return ['сохранено','сохраняется','не сохранено','ошибка','Сохраняем'].filter(s => t.toLowerCase().includes(s.toLowerCase())); })()").catch(() => null);
  // вернуть стейдж «люди» у ученика
  await S.click(byLabel("Свернуть задание")).catch(() => {});
  return { ok: ok && saved.ok, openMs, saveMs: saved.ok ? Date.now() - t1 : null, qid, uiStatus };
}

/** Полный раунд действий на текущей сети. */
async function actionsRound(name) {
  L.sampleTag.v = name;
  const R = { name, net: { ...L.netState }, steps: {}, t0: Date.now() };
  const step = async (key, fn) => {
    const t = Date.now();
    try { R.steps[key] = await fn(); } catch (e) { R.steps[key] = { ok: false, err: String(e).slice(0, 200) }; }
    R.steps[key].wallMs = Date.now() - t;
    log({ kind: R.steps[key].ok ? "STEP_OK" : "STEP_FAIL", text: `${name}: ${key}`, extra: R.steps[key] });
  };
  await step("media", () => mediaCheck(name));
  await step("chatT2S", () => L.chat(T, S, `${name}-t2s`, 30000));
  await step("chatS2T", () => L.chat(S, T, `${name}-s2t`, 30000));
  await step("teacherMic", () => toggleMic(T, S));
  await step("studentMic", () => toggleMic(S, T));
  await step("teacherCam", () => toggleCam(T, S));
  await step("studentCam", () => toggleCam(S, T));
  await step("screenShare", () => screenShare());
  await step("board", () => board(Object.keys(ROUNDS).length));
  await step("answer", () => answer(name));
  await step("mediaEnd", () => mediaCheck(name, 20000));
  R.ui = { teacher: await L.uiState(T), student: await L.uiState(S) };
  R.lk = L.lastSample.livekit;
  R.ms = Date.now() - R.t0;
  await L.shot(`round-${name}`);
  return R;
}

/** После плохой сети: NORMAL, всё должно вернуться само (без F5 и кликов). */
async function recovery(name, who = "both", timeoutMs = 60000) {
  const t0 = Date.now();
  await L.setProfile(who, "NORMAL");
  L.sampleTag.v = `${name}/recovery`;
  const m = await waitFor(async () => { const r = await L.mediaBoth(); return L.allMedia(r) ? r : null; }, timeoutMs, 1000);
  const mediaMs = m.ok ? Date.now() - t0 : null;
  const lk = await L.lkParticipants();
  const ids = (lk.list || []).filter((x) => !x.identity.startsWith("EG_")).map((x) => x.identity);
  const pubs = (lk.list || []).map((x) => `${x.name}:${x.tracks.filter((t) => !t.includes("muted")).sort().join("+")}`);
  const c1 = await L.chat(T, S, `${name}-rec-t2s`, 20000);
  const c2 = await L.chat(S, T, `${name}-rec-s2t`, 20000);
  const ui = { teacher: await L.uiState(T), student: await L.uiState(S) };
  const camUi = { teacher: await L.ctlState(T, L.CAM), student: await L.ctlState(S, L.CAM) };
  const micUi = { teacher: await L.ctlState(T, L.MIC), student: await L.ctlState(S, L.MIC) };
  const r = { ok: m.ok && c1.ok && c2.ok && ids.length === 2 && ui.student.inRoom && ui.teacher.inRoom, mediaMs, pubs, participants: ids.length, dup: ids.length !== new Set(ids).size, chat: c1.ok && c2.ok, chatDup: [c1.copiesAtReceiver, c2.copiesAtReceiver], ui, camUi, micUi };
  if (!m.ok) r.media = await L.mediaBoth();
  check(`${name}: recovered on NORMAL`, r.ok, r);
  return r;
}

// ── набор: матрица профилей ──
async function matrix() {
  const list = (process.env.PROFILES || "NORMAL,BAD_4G,3G,BAD_3G,EXTREME,HORRIBLE,LOSS5,LOSS10").split(",");
  for (const prof of list) {
    mark(`=== profile ${prof} (both) ===`);
    await L.setProfile(process.env.WHO || "both", prof);
    await sleep(Number(process.env.SETTLE_SEC || 20) * 1000); // дать BWE/слоям перестроиться
    const R = await actionsRound(prof);
    if (prof !== "NORMAL") R.recovery = await recovery(prof, process.env.WHO || "both");
    ROUNDS[prof] = R;
    L.writeSummary({ suite: SUITE, rounds: ROUNDS });
  }
}

// ── набор: переходы и обрывы (сеть ученика) ──
async function outage(name, sec, base = "NORMAL") {
  // во время обрыва: учитель пишет в чат и меняет стейдж (доска) — после возврата ученик должен это увидеть
  const before = { pcs: await S.eval("window.__pcs.length"), lkWs: 0 };
  mark(`${name}: student network OFF ${sec}s (base ${base})`);
  await L.cut("student", true);
  const tCut = Date.now();
  await sleep(Math.min(3000, sec * 1000 / 3));
  const missed = await L.chat(T, S, `${name}-during`, 2000).catch(() => ({}));
  // ученик пытается писать без сети
  const sDuring = `e2e-${name}-offline-${Date.now() % 100000}`;
  await L.openDrawer(S, "Чат");
  await S.click(byLabel("Сообщение классу")); await S.type(sDuring); await L.press(S, "Отправить");
  const boardBefore = (await T.eval(`(() => { const b=${byLabel("Доска")}; return b && b.getAttribute('aria-pressed'); })()`)) === "true";
  await L.press(T, "Доска"); // смена стейджа, пока ученика нет
  const stageWanted = !boardBefore;
  const uiDuring = [];
  while (Date.now() - tCut < sec * 1000) { uiDuring.push({ s: Math.round((Date.now() - tCut) / 1000), ui: await L.uiState(S) }); await sleep(2500); }
  await L.cut("student", false);
  const tUp = Date.now();
  mark(`${name}: network ON`);
  const pc = await waitFor(() => S.eval("window.__pcs.some(p=>p.connectionState==='connected')"), 120000, 250);
  const media = await waitFor(async () => { const r = await L.mediaBoth(); return L.allMedia(r) ? r : null; }, 120000, 1000);
  const audioMs = media.ok ? Date.now() - tUp : null;
  const ws = await waitFor(() => S.openWs().some((u) => u.includes("/ws?")), 60000, 250);
  // пропущенное во время обрыва: сообщение учителя (ровно 1 копия), стейдж
  const gotMissed = await waitFor(async () => (await L.countText(S, missed.text)) >= 1, 30000, 500);
  const missedCopies = await L.countText(S, missed.text);
  const stageSynced = await waitFor(async () => (await S.eval("!!document.querySelector('.excalidraw canvas')")) === stageWanted, 30000, 500);
  // что стало с сообщением ученика, отправленным без сети
  await sleep(2000);
  const offlineMsg = { atTeacher: await L.countText(T, sDuring), atStudent: await L.countText(S, sDuring), errShown: await S.eval(`document.body.innerText.includes('Сообщение не отправлено')`).catch(() => null), draftKept: await S.eval(`(document.querySelector('[aria-label="Сообщение классу"]')||{}).value || ''`).catch(() => null) };
  // новые сообщения после восстановления
  const c1 = await L.chat(T, S, `${name}-after-t2s`, 20000);
  const c2 = await L.chat(S, T, `${name}-after-s2t`, 20000);
  // вернуть стейдж
  if (stageWanted) await L.press(T, "Доска");
  const lk = await L.lkParticipants();
  const ids = (lk.list || []).filter((x) => !x.identity.startsWith("EG_")).map((x) => x.identity);
  const after = { pcs: await S.eval("window.__pcs.length") };
  const r = { sec, base, pcReconnectMs: pc.ok ? Date.now() - tUp - 0 : null, mediaMs: audioMs, roomWs: ws.ok, roomWsMs: ws.ok ? ws.ms : null,
    missedChat: { delivered: gotMissed.ok, copies: missedCopies }, stageSynced: stageSynced.ok, offlineMsg, chatAfter: c1.ok && c2.ok, chatAfterDup: [c1.copiesAtReceiver, c2.copiesAtReceiver],
    participants: ids.length, dup: ids.length !== new Set(ids).size, newPCs: after.pcs - before.pcs, uiDuring: uiDuring.filter((x, i) => i % 2 === 0).map((x) => ({ s: x.s, overlay: x.ui.overlayReconnect, pill: x.ui.pill, lkWarn: x.ui.lkWarn, q: x.ui.quality })), uiAfter: await L.uiState(S) };
  r.pcReconnectMs = pc.ok ? pc.ms : null;
  r.ok = r.mediaMs !== null && r.roomWs && r.missedChat.delivered && r.missedChat.copies === 1 && r.stageSynced && r.chatAfter && ids.length === 2 && !r.dup;
  check(`${name}: outage ${sec}s recovered (media, WS, missed chat, stage, no dup)`, r.ok, r);
  await L.shot(`outage-${name}`);
  return r;
}
async function transitions() {
  const only = (process.env.ONLY || "A,B,C,D,E,F,G,H,W").split(",");
  const W = "student";
  const hold = Number(process.env.HOLD_SEC || 60) * 1000;
  const probe = async (name) => { // короткая проверка на текущей сети: звук, чат
    const m = await mediaCheck(name, 30000);
    const c = await L.chat(S, T, `${name}-p`, 30000);
    return { media: m, chat: c.ok, chatMs: c.ms };
  };
  if (only.includes("A")) { const r = {}; mark("=== Scenario A: NORMAL→BAD_4G→NORMAL ===");
    r.normal = await probe("A-normal"); await L.setProfile(W, "BAD_4G"); await sleep(hold); r.bad4g = await probe("A-bad4g");
    r.recovery = await recovery("A", W); ROUNDS.A = r; }
  if (only.includes("B")) { const r = {}; mark("=== Scenario B: NORMAL→3G→BAD_3G→NORMAL ===");
    await L.setProfile(W, "3G"); await sleep(hold); r.g3 = await probe("B-3g"); await L.setProfile(W, "BAD_3G"); await sleep(hold); r.bad3g = await probe("B-bad3g");
    r.recovery = await recovery("B", W); ROUNDS.B = r; }
  if (only.includes("C")) { const r = {}; mark("=== Scenario C: NORMAL→5%→10% loss→NORMAL ===");
    await L.setProfile(W, "LOSS5"); await sleep(hold); r.l5 = await probe("C-loss5"); await L.setProfile(W, "LOSS10"); await sleep(hold); r.l10 = await probe("C-loss10");
    r.recovery = await recovery("C", W); ROUNDS.C = r; }
  for (const [k, sec] of [["D", 5], ["E", 15], ["F", 30], ["G", 60]]) {
    if (!only.includes(k)) continue;
    mark(`=== Scenario ${k}: NORMAL→OFF ${sec}s→NORMAL ===`);
    ROUNDS[k] = { outage: await outage(k, sec) };
    ROUNDS[k].recovery = await recovery(k, W);
    await sleep(10000);
  }
  if (only.includes("W")) { mark("=== Scenario W: TCP/443 silently blackholed 45 s, UDP media alive ===");
    const sec = Number(process.env.W_SEC || 45);
    await L.closeDrawers(S); await L.openDrawer(S, "Чат");
    await L.block("student", "tcp443");
    const t0 = Date.now();
    await sleep(4000);
    const during = await L.chat(T, S, "W-during", 3000);
    const boardWas = (await T.eval(`(() => { const b=${byLabel("Доска")}; return b && b.getAttribute('aria-pressed'); })()`)) === "true";
    await L.press(T, "Доска");
    const ui = [];
    while (Date.now() - t0 < sec * 1000) { ui.push({ s: Math.round((Date.now() - t0) / 1000), ui: await L.uiState(S), ws: S.openWs().length, audio: hears(await flow(S, 1500)) }); await sleep(3000); }
    await L.block("student", "none");
    const tUp = Date.now();
    const got = await waitFor(async () => (await L.countText(S, during.text)) >= 1, 60000, 500);
    const stage = await waitFor(async () => (await S.eval("!!document.querySelector('.excalidraw canvas')")) === !boardWas, 60000, 500);
    if (!boardWas) await L.press(T, "Доска");
    const c = await L.chat(T, S, "W-after", 20000);
    ROUNDS.W = { sec, missedChatDeliveredMs: got.ok ? Date.now() - tUp : null, missedCopies: await L.countText(S, during.text), stageSynced: stage.ok, stageMs: stage.ok ? stage.ms : null, chatAfter: c.ok,
      uiDuring: ui.map((x) => ({ s: x.s, audio: x.audio, overlay: x.ui.overlayReconnect, pill: x.ui.pill, lkWarn: x.ui.lkWarn, ws: x.ws })) };
    check("W: events resume after TCP blackhole (missed chat once, stage synced)", got.ok && ROUNDS.W.missedCopies === 1 && stage.ok && c.ok, ROUNDS.W);
    ROUNDS.W.recovery = await recovery("W", W); }
  if (only.includes("R")) { mark("=== Scenario R: TCP/443 reset 8 s (WS closes and reconnects), stage changed meanwhile ===");
    await L.closeDrawers(S); await L.openDrawer(S, "Чат");
    const wsBefore = (await S.eval("1")) && null;
    const boardWas = (await T.eval(`(() => { const b=${byLabel("Доска")}; return b && b.getAttribute('aria-pressed'); })()`)) === "true";
    await L.block("student", "tcp443rst");
    const t0 = Date.now();
    await sleep(1500);
    await L.press(T, "Доска"); // стейдж меняется, пока WS ученика закрыт
    const during = await L.chat(T, S, "R-during", 2000);
    await sleep(Math.max(0, 8000 - (Date.now() - t0)));
    await L.block("student", "none");
    const tUp = Date.now();
    const ws = await waitFor(() => S.openWs().some((u) => u.includes("/ws?")), 40000, 250);
    const stage = await waitFor(async () => (await S.eval("!!document.querySelector('.excalidraw canvas')")) === !boardWas, 30000, 500);
    const got = await waitFor(async () => (await L.countText(S, during.text)) >= 1, 30000, 500);
    if (!boardWas) await L.press(T, "Доска");
    ROUNDS.R = { wsReconnectMs: ws.ok ? Date.now() - tUp : null, stageSynced: stage.ok, stageMs: stage.ok ? stage.ms : null, missedChat: got.ok, missedCopies: await L.countText(S, during.text) };
    check("R: after real WS reconnect — stage and missed chat synced", stage.ok && got.ok && ROUNDS.R.missedCopies === 1, ROUNDS.R);
    ROUNDS.R.recovery = await recovery("R", W); }
  if (only.includes("H")) { mark("=== Scenario H: BAD_3G→OFF 15s→BAD_3G→NORMAL ===");
    await L.setProfile(W, "BAD_3G"); await sleep(30000);
    const r = { outage: await outage("H", 15, "BAD_3G") };
    r.afterOnBad3g = await probe("H-bad3g-after");
    r.recovery = await recovery("H", W); ROUNDS.H = r; }
  L.writeSummary({ suite: SUITE, rounds: ROUNDS });
}

// ── набор: длительная деградация ──
async function longRun() {
  const cycle = ["NORMAL", "BAD_4G", "3G", "BAD_3G", "NORMAL"];
  const per = Number(process.env.PHASE_MIN || 5) * 60000;
  const cycles = Number(process.env.CYCLES || 2);
  const phases = [];
  let k = 0;
  const maxMs = Number(process.env.MAX_MIN || 0) * 60000;
  const longStart = Date.now();
  outer: for (let c = 0; c < cycles; c++) for (const prof of cycle) {
    if (maxMs && Date.now() - longStart >= maxMs - 30000) break outer;
    mark(`=== long: cycle ${c + 1} phase ${prof} ===`);
    await L.setProfile("both", prof);
    L.sampleTag.v = `long-${c + 1}-${prof}`;
    const end = Date.now() + per;
    const ph = { cycle: c + 1, prof, minutes: [] };
    while (Date.now() < end) {
      await sleep(Math.min(60000, Math.max(0, end - Date.now() - 1000)));
      if (Date.now() >= end - 500 && ph.minutes.length) break;
      k++;
      const m = await mediaCheck(`long${k}`, 20000);
      const c1 = k % 2 ? await L.chat(T, S, `long${k}`, 30000) : await L.chat(S, T, `long${k}`, 30000);
      const met = { teacher: await T.metrics().catch(() => null), student: await S.metrics().catch(() => null) };
      const wsCount = { teacher: T.openWs().length, student: S.openWs().length };
      ph.minutes.push({ k, media: m.ok, audio: [m.audioT2S, m.audioS2T], video: [m.videoT2S, m.videoS2T], chat: c1.ok, chatMs: c1.ms, chatDup: c1.copiesAtReceiver,
        heapMB: { t: Math.round((met.teacher?.JSHeapUsedSize || 0) / 1048576), s: Math.round((met.student?.JSHeapUsedSize || 0) / 1048576) },
        listeners: { t: met.teacher?.JSEventListeners, s: met.student?.JSEventListeners }, nodes: { t: met.teacher?.Nodes, s: met.student?.Nodes }, wsCount, lkParticipants: (L.lastSample.livekit?.list || []).length });
      log({ kind: "long.min", text: `${prof} #${k}`, extra: ph.minutes.at(-1) });
      if (k % 5 === 0) { const b = await board(k).catch((e) => ({ ok: false, err: String(e) })); ph.minutes.at(-1).board = b.ok; }
    }
    phases.push(ph);
    ROUNDS.long = { phases };
    L.writeSummary({ suite: SUITE, rounds: ROUNDS });
  }
  ROUNDS.long.final = await recovery("long-final", "both");
}

// ── набор: TURN / TCP-фолбэк ──
async function turn() {
  for (const mode of (process.env.MODES || "udp,udp_tcp7881,direct_udp").split(",")) {
    mark(`=== TURN/TCP: block=${mode} (student) ===`);
    // новый вход ученика с уже закрытым путём: перезагрузка страницы (F5 → сразу в урок)
    await L.block("student", mode);
    const t0 = Date.now();
    await S.reload();
    await sleep(2000);
    await L.passDeviceCheck(S, true, 90000);
    await L.setCtl(S, L.CAM, true); await L.setCtl(S, L.MIC, true);
    const m = await waitFor(async () => { const r = await L.mediaBoth(); return L.audioBoth(r) ? r : null; }, 90000, 1000);
    const joinMs = m.ok ? Date.now() - t0 : null;
    await sleep(6000);
    const path = L.lastSample.student?.pair;
    const out = await outage(`turn-${mode}`, 15);
    const pathAfter = L.lastSample.student?.pair;
    const full = await mediaCheck(`turn-${mode}`, 30000);
    ROUNDS[`turn-${mode}`] = { mode, mediaOk: m.ok, joinToAudioMs: joinMs, path, outage15: out, pathAfter, mediaAfter: full };
    check(`turn ${mode}: media works, path=${path}`, m.ok && full.ok, ROUNDS[`turn-${mode}`]);
    await L.block("student", "none");
    await S.reload(); await sleep(2000); await L.passDeviceCheck(S, true, 60000);
    await L.setCtl(S, L.CAM, true); await L.setCtl(S, L.MIC, true);
    await sleep(8000);
    L.writeSummary({ suite: SUITE, rounds: ROUNDS });
  }
}

// ── набор: урок с включённой записью (egress на этом же 2-ядерном хосте) ──
async function recordingSuite() {
  const recBadge = (p) => p.eval(`[...document.querySelectorAll('.sr-only')].some(e => e.textContent.includes('Идёт запись урока'))`).catch(() => null);
  mark("=== recording: start via teacher UI ===");
  await L.openDrawer(T, "Материалы урока");
  await T.click(byText("button", "Запись урока")); await sleep(1200);
  await T.click(byText("button", "Начать запись")); await sleep(800);
  await T.click(byText("button", "Да, начать запись"));
  const t0 = Date.now();
  const eg = await waitFor(async () => ((await L.lkParticipants()).list || []).some((x) => x.identity.startsWith("EG_")), 60000, 1000);
  const badgeS = await waitFor(() => recBadge(S), 30000, 500);
  const row = await L.sql(`select id, status from recordings where lesson_id='${L.LID}' order by started_at desc limit 1`);
  const R = { egressJoinedMs: eg.ok ? Date.now() - t0 : null, studentSeesBadge: badgeS.ok, row: row[0], phases: {} };
  check("recording: egress joined + student sees recording badge", eg.ok && badgeS.ok, R);
  await T.click(byLabel("Материалы урока")).catch(() => {});
  const phase = async (name) => {
    const st = await L.hostStats().catch(() => null);
    const r = { media: await mediaCheck(`rec-${name}`, 30000), chat: (await L.chat(T, S, `rec-${name}`, 30000)).ok, host: st };
    R.phases[name] = r; log({ kind: "rec.phase", text: name, extra: r });
    return r;
  };
  L.sampleTag.v = "rec-NORMAL"; await sleep(20000); await phase("NORMAL");
  R.phases.board = await board(77);
  await L.setProfile("student", "BAD_3G"); L.sampleTag.v = "rec-BAD_3G"; await sleep(45000); await phase("BAD_3G");
  R.outage = await outage("rec-outage", 15, "BAD_3G");
  R.recovery = await recovery("rec", "student");
  R.badgeAfterReconnect = await recBadge(S);
  L.sampleTag.v = "rec-NORMAL-2"; await sleep(30000); await phase("NORMAL-2");
  mark("=== recording: stop ===");
  await L.openDrawer(T, "Материалы урока");
  await T.click(byText("button", "Запись урока")); await sleep(1200);
  await T.click(byText("button", "Остановить запись"));
  const done = await waitFor(async () => { const r = await L.sql(`select id, status, duration_sec from recordings where lesson_id='${L.LID}' order by started_at desc limit 1`); return r[0] && !/recording|stopping|starting/i.test(r[0]) ? r[0] : null; }, 180000, 3000);
  R.final = done.v || (await L.sql(`select id, status from recordings where lesson_id='${L.LID}' order by started_at desc limit 1`))[0];
  R.badgeGoneAtStudent = (await waitFor(async () => !(await recBadge(S)), 30000, 1000)).ok;
  check("recording: stopped and finalized", done.ok, R);
  ROUNDS.recording = R;
}

try {
  await setup();
  if (SUITE === "smoke") { ROUNDS.smoke = await actionsRound("smoke"); }
  else if (SUITE === "matrix") await matrix();
  else if (SUITE === "transitions") await transitions();
  else if (SUITE === "long") await longRun();
  else if (SUITE === "turn") await turn();
  else if (SUITE === "recording") await recordingSuite();
} catch (e) {
  log({ kind: "SCENARIO_ERROR", text: String(e.stack || e).slice(0, 1500) });
  await L.shot("99-error").catch(() => {});
}
await L.ctl({ cmd: "clear", who: "both" }).catch(() => {});
await L.ctl({ cmd: "cut", who: "both", on: false }).catch(() => {});
await L.ctl({ cmd: "block", who: "both", mode: "none" }).catch(() => {});
await L.finish({ suite: SUITE, rounds: ROUNDS });
