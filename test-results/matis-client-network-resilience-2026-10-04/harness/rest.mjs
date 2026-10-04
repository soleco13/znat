// REST/API под отказами. Отказы вносятся в браузере через CDP Fetch (перехват запроса
// на стадии Request или Response), код приложения и сервер не меняются.
//   fail      — соединение оборвано до сервера (ConnectionReset / TimedOut)
//   status    — ответ 503/429/408/401 вместо сервера
//   delay     — запрос держится N мс, потом уходит на сервер
//   lostResp  — сервер ОБРАБОТАЛ запрос, но ответ до клиента не дошёл (стадия Response)
import * as L from "./lib.mjs";
import { connectBrowser, openPage } from "./cdp.mjs";
const { sleep, byText, byLabel, check, log, mark, waitFor } = L;

const RESULTS = {};
function injector(page) {
  const rules = [];
  const hits = [];
  const b = page.browser;
  const orig = b.listeners.get(page.sessionId);
  b.listeners.set(page.sessionId, (method, p) => {
    if (method === "Fetch.requestPaused") return void onPaused(p);
    orig(method, p);
  });
  async function onPaused(p) {
    const url = p.request.url.replace(L.ORIGIN, "");
    const atResponse = p.responseStatusCode != null || p.responseErrorReason != null;
    const rule = rules.find((r) => r.left > 0 && r.method === p.request.method && r.re.test(url) && (r.action === "lostResp") === atResponse);
    const send = (m, x) => page.send(m, { requestId: p.requestId, ...x }).catch((e) => log({ kind: "inject.err", text: String(e) }));
    if (!rule) return send(atResponse ? "Fetch.continueResponse" : "Fetch.continueRequest", {});
    rule.left--;
    hits.push({ t: Date.now(), action: rule.action, url, method: p.request.method, status: p.responseStatusCode });
    log({ who: page.name, kind: "INJECT", text: `${rule.action}${rule.status ? " " + rule.status : ""} ${p.request.method} ${url.slice(0, 80)}` });
    if (rule.action === "fail" || rule.action === "lostResp") return send("Fetch.failRequest", { errorReason: rule.reason || "ConnectionReset" });
    if (rule.action === "status") return send("Fetch.fulfillRequest", { responseCode: rule.status, responseHeaders: [{ name: "content-type", value: "application/json" }, ...(rule.status === 429 ? [{ name: "retry-after", value: "2" }] : [])], body: Buffer.from(JSON.stringify({ error: "injected", message: "injected " + rule.status })).toString("base64") });
    if (rule.action === "delay") { await sleep(rule.ms); return send("Fetch.continueRequest", {}); }
  }
  return {
    hits,
    async add(method, re, action, opts = {}) { rules.push({ method, re, action, left: opts.times ?? 1, ...opts }); await this.sync(); },
    async clear() { rules.length = 0; await this.sync(); },
    async sync() {
      const live = rules.filter((r) => r.left > 0);
      if (!live.length) return page.send("Fetch.disable").catch(() => {});
      return page.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/v1/*", requestStage: "Request" }, { urlPattern: "*/api/v1/*", requestStage: "Response" }] });
    },
  };
}

const tb = await connectBrowser(process.env.T_CDP), sb = await connectBrowser(process.env.S_CDP);
for (const b of [tb, sb]) for (const ti of (await b.call("Target.getTargets")).targetInfos) if (ti.type === "page") await b.call("Target.closeTarget", { targetId: ti.targetId }).catch(() => {});
const TP = await openPage(tb, "teacher", L.log); TP.browser = tb;
const SP = await openPage(sb, "student", L.log); SP.browser = sb;
const TI = injector(TP), SI = injector(SP);
await L.setProfile("both", "NORMAL");

const count = (q) => L.sql(q).then((r) => Number(r[0] || 0));
const rec = (k, v) => { RESULTS[k] = v; check(`rest: ${k}`, v.ok, v); };

// 1. login: 503 → понятная ошибка, повтор входа работает; 429; обрыв
for (const [kind, add] of [["503", () => TI.add("POST", /\/auth\/login/, "status", { status: 503 })], ["429", () => TI.add("POST", /\/auth\/login/, "status", { status: 429 })], ["reset", () => TI.add("POST", /\/auth\/login/, "fail")]]) {
  await TP.send("Network.clearBrowserCookies");
  await TP.goto(`${L.ORIGIN}/login`);
  await waitFor(() => TP.eval("!!document.querySelector('input[type=email]')"), 30000);
  await add();
  await TP.click("document.querySelector('input[type=email]')"); await TP.type(process.env.T_EMAIL || "teacher@school.dev");
  await TP.click("document.querySelector('input[type=password]')"); await TP.type(process.env.T_PW || "password123");
  await TP.click("document.querySelector('button[type=submit]')");
  await sleep(2500);
  const msg = await TP.eval("(document.querySelector('[role=alert]')||{}).innerText || ''");
  const stuck = await TP.eval("!!document.querySelector('button[type=submit][disabled]')");
  await TP.click("document.querySelector('button[type=submit]')");
  const ok = await waitFor(() => TP.eval("location.pathname.startsWith('/lessons')"), 20000);
  rec(`login ${kind}: error shown, manual retry logs in`, { ok: ok.ok && !!msg && !stuck, msg: msg.slice(0, 120), stuckButton: stuck, retryMs: ok.ms });
}

// 2. вход в урок: /join 503, обрыв, задержка дольше таймаута клиента
async function teacherJoin(injectFn, label) {
  await TP.goto(`${L.ORIGIN}/lessons/${L.LID}/room`);
  await waitFor(() => TP.eval(`!!${byText("button", "Присоединиться")}`), 30000);
  if (injectFn) await injectFn();
  await sleep(800);
  const t0 = Date.now();
  await TP.click(byText("button", "Присоединиться"));
  // кнопка «Чат» есть ещё до ответа /join — результат определяем по факту: медиа подключилось или баннер «Повторить»
  const res = await waitFor(async () => (await TP.eval(`!!${byText("button", "Повторить")}`)) ? "retry" : (await TP.eval("(window.__pcs||[]).some(p=>p.connectionState==='connected')")) ? "room" : null, 60000, 300);
  const state = res.v;
  let retried = null;
  if (state === "retry") {
    const banner = await TP.eval("document.body.innerText.slice(0, 400)");
    await TP.click(byText("button", "Повторить"));
    const r2 = await waitFor(async () => !!(await TP.eval(`!!${byLabel("Чат")}`)) && (await TP.eval("(window.__pcs||[]).some(p=>p.connectionState==='connected')")), 40000, 300);
    retried = { ok: r2.ok, ms: r2.ms, banner: banner.replace(/\s+/g, " ").slice(0, 200) };
  }
  const lk = await L.lkParticipants();
  const pcs = await TP.eval("(window.__pcs||[]).some(p=>p.connectionState==='connected')").catch(() => false);
  return { state, firstMs: res.ok ? Date.now() - t0 : null, retried, lkParticipants: (lk.list || []).map((x) => x.name), mediaConnected: pcs };
}
{
  const r = await teacherJoin(() => TI.add("POST", /\/lessons\/[^/]+\/join$/, "status", { status: 503 }));
  rec("join 503: retry banner + recovery by click", { ok: r.state === "retry" && r.retried?.ok, ...r });
  const r2 = await teacherJoin(() => TI.add("POST", /\/lessons\/[^/]+\/join$/, "fail"));
  rec("join connection reset: retry banner + recovery by click", { ok: r2.state === "retry" && r2.retried?.ok, ...r2 });
  // сервер принял /join, ответ потерян → повторный /join не плодит участника
  const r3 = await teacherJoin(() => TI.add("POST", /\/lessons\/[^/]+\/join$/, "lostResp"));
  const dupT = (r3.lkParticipants || []).filter((n) => n.startsWith("E2E Учитель") || n.startsWith("Тимур")).length;
  rec("join response lost (server processed): retry → single participant", { ok: (r3.state === "room" || r3.retried?.ok) && dupT <= 1, dupT, ...r3 });
  const r4 = await teacherJoin(() => TI.add("POST", /\/lessons\/[^/]+\/join$/, "delay", { ms: 35000 }));
  rec("join delayed 35 s (> client timeout 30 s): timeout shown, retry works", { ok: (r4.state === "retry" && r4.retried?.ok) || r4.state === "room", ...r4 });
}
// учитель гарантированно в уроке (живой WS + медиа) — дальше он получатель чата
await TP.goto(`${L.ORIGIN}/lessons/${L.LID}/room`);
await waitFor(async () => (await TP.eval(`!!${byLabel("Чат")}`)) || TP.eval(`!!${byText("button", "Присоединиться")}`), 30000);
if (await TP.eval(`!!${byText("button", "Присоединиться")}`)) { await sleep(800); await TP.click(byText("button", "Присоединиться")); }
check("rest: teacher back in room (media connected)", (await waitFor(() => TP.eval("(window.__pcs||[]).some(p=>p.connectionState==='connected')"), 40000)).ok);
// ученик
await SP.goto(`${L.ORIGIN}${L.JOIN}`);
await waitFor(() => SP.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`), 30000);
await SP.click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await SP.type("E2E Ученик REST");
await SP.click(`document.querySelector('[role=checkbox]')`); await sleep(300);
await SP.click("document.querySelector('button[type=submit]')");
await waitFor(() => SP.eval(`!!${byText("button", "Присоединиться")}`), 30000); await sleep(800);
await SP.click(byText("button", "Присоединиться"));
check("rest: student in room", (await waitFor(() => SP.eval(`!!${byLabel("Чат")}`), 30000)).ok);
await sleep(3000);
const openChat = async (p) => { const st = await p.eval(`(() => { const b = ${byLabel("Чат")}; return b ? b.getAttribute('aria-pressed') : null; })()`); if (st !== "true") await p.click(byLabel("Чат")); await sleep(500); };
await openChat(TP); await openChat(SP);
const typeSend = async (p, text) => { await p.click(byLabel("Сообщение классу")); await p.type(text); await p.click(byLabel("Отправить")); };

// 3. чат: 503 → «не отправлено», текст возвращён, без дубля; ответ потерян (сервер сохранил) → дубль при повторе?
{
  const text = `rest-chat503-${Date.now() % 100000}`;
  await SI.add("POST", /\/chat$/, "status", { status: 503 });
  await typeSend(SP, text); await sleep(2500);
  const err = await SP.eval("document.body.innerText.includes('Сообщение не отправлено')");
  const draft = await SP.eval(`(document.querySelector('[aria-label="Сообщение классу"]')||{}).value || ''`);
  const atTeacher = await L.countText(TP, text);
  rec("chat 503: error shown, draft restored, nothing delivered", { ok: err && draft === text && atTeacher === 0, err, draftRestored: draft === text, atTeacher });
  await SP.click(byLabel("Отправить"));
  const d = await waitFor(async () => (await L.countText(TP, text)) >= 1, 15000, 300);
  await sleep(1500);
  rec("chat 503 → user resend: delivered once", { ok: d.ok && (await L.countText(TP, text)) === 1, copies: await L.countText(TP, text) });
}
{
  const text = `rest-chatlost-${Date.now() % 100000}`;
  await SI.add("POST", /\/chat$/, "lostResp");
  await typeSend(SP, text); await sleep(3000);
  const err = await SP.eval("document.body.innerText.includes('Сообщение не отправлено')");
  const draft = await SP.eval(`(document.querySelector('[aria-label="Сообщение классу"]')||{}).value || ''`);
  const atTeacher1 = await L.countText(TP, text);
  // человек видит «не отправлено» и текст в поле — нажимает «Отправить» ещё раз
  if (draft === text) { await SP.click(byLabel("Отправить")); await sleep(3000); }
  const atTeacher2 = await L.countText(TP, text), atStudent = await L.countText(SP, text);
  const db = await count(`select count(*) from chat_messages where lesson_id='${L.LID}' and body='${text}'`);
  rec("chat response lost (server saved): user sees state consistent, no duplicate after resend", { ok: db === 1 && atTeacher2 === 1, errShown: err, draftRestored: draft === text, atTeacherBeforeResend: atTeacher1, atTeacherAfterResend: atTeacher2, atStudent, dbRows: db });
}

// 4. задание: загрузка материала 503 / обрыв, сохранение ответа 503 → автоповтор, ответ потерян → идемпотентно
const sid = ((await L.lkParticipants()).list || []).find((x) => (x.name || "").includes("REST"))?.identity;
const openActivity = async () => {
  await SP.click(byLabel("Материалы урока")); await sleep(700);
  await SP.click(byText("button", "Задание")); await sleep(500);
};
const activityState = () => SP.eval("document.body.innerText.includes('Не удалось загрузить задание') ? 'error' : document.querySelector('input[type=radio][name^=\"q-\"]') || document.body.innerText.includes('ответы сохраняются') ? 'ok' : 'loading'");
{
  await SI.add("GET", /\/activities\/[^/]+\/my$/, "status", { status: 503 });
  await openActivity();
  const r = await waitFor(async () => { const s = await activityState(); return s !== "loading" ? s : null; }, 40000, 500);
  let selfHeal = null, afterReopen = null;
  if (r.v === "error") {
    const h = await waitFor(async () => (await activityState()) === "ok", 20000, 1000); selfHeal = h.ok;
    if (!h.ok) { await SP.click(byLabel("Свернуть задание")).catch(() => {}); await sleep(500); await openActivity(); afterReopen = (await waitFor(async () => (await activityState()) === "ok", 30000, 500)).ok; }
  }
  const okMat = r.v === "ok" || selfHeal || afterReopen || false;
  rec("material load 503 once: recovers without page reload", { ok: okMat, firstState: r.v, selfHealWithin20s: selfHeal, recoversByReopen: afterReopen });
  await SP.click(byLabel("Свернуть задание")).catch(() => {});
  if (!okMat) { // без F5 не выйти — перезагружаем, чтобы проверить остальное
    await SP.reload(); await sleep(2000);
    await waitFor(async () => (await SP.eval(`!!${byLabel("Чат")}`)) || SP.eval(`!!${byText("button", "Присоединиться")}`), 40000);
    if (await SP.eval(`!!${byText("button", "Присоединиться")}`)) { await sleep(800); await SP.click(byText("button", "Присоединиться")); }
    await waitFor(() => SP.eval(`!!${byLabel("Чат")}`), 40000); await sleep(3000);
  }
}
// Вариант ищем по индексу в группе, а не по [value=…]: у «Верно/Неверно» атрибута value нет
// (свойство .value = "on"), селектор по атрибуту ничего не находил.
const radioSel = (t) => `[...document.querySelectorAll('input[type=radio][name=${JSON.stringify(t.name)}]')].filter((x, i) => i === ${t.idx})`;
// single_choice хранит id варианта, true_false — {"value": true|false}
const savedFragment = (t) => t.attr ?? (t.text === "Верно" ? '"value": true' : '"value": false');
async function answerOne(label, inject) {
  await openActivity();
  await waitFor(async () => (await activityState()) === "ok", 40000, 500);
  let target = null;
  for (let i = 0; i < 20 && !target; i++) {
    target = await SP.eval(`(() => { const r = [...document.querySelectorAll('input[type=radio][name^="q-"]')].filter(x => !x.checked && x.closest('label')?.getBoundingClientRect().width > 0); const used = new Set([...document.querySelectorAll('input[type=radio][name^="q-"]:checked')].map(x => x.name)); const n = r.map(x => x.name).find(n => !used.has(n)); if (!n) return null; const all = [...document.querySelectorAll('input[type=radio][name="' + n + '"]')]; const o = r.find(x => x.name === n); return { name: n, idx: all.indexOf(o), attr: o.getAttribute('value'), text: (o.closest('label')?.textContent || '').trim() }; })()`);
    if (!target) { await SP.click(byLabel("Следующая страница")); await sleep(1200); }
  }
  if (!target) { await SP.click(byLabel("Свернуть задание")).catch(() => {}); return { ok: false, why: "no question visible (activity not loaded)" }; }
  if (inject) await inject();
  const sel = radioSel(target);
  let checked = false;
  for (let i = 0; i < 5 && !checked; i++) {
    await SP.click(`(${sel}.map(x => x.closest('label')).find(l => l && l.getBoundingClientRect().width > 0) || null)`);
    await sleep(600);
    checked = await SP.eval(`${sel}.some(x => x.checked)`).catch(() => false);
  }
  if (!checked) { await SP.click(byLabel("Свернуть задание")).catch(() => {}); return { ok: false, why: "harness: radio click not applied", target }; }
  const qid = target.name.slice(2);
  const saved = await waitFor(async () => (await count(`select count(*) from responses where question_id='${qid}' and participant_id in (select id from lesson_participants where guest_id::text='${sid}' or user_id::text='${sid}') and response::text like '%${savedFragment(target)}%'`)) > 0, 45000, 1000);
  const rows = await count(`select count(*) from responses where question_id='${qid}' and participant_id in (select id from lesson_participants where guest_id::text='${sid}' or user_id::text='${sid}')`);
  const ui = await SP.eval("document.body.innerText.match(/ответы[^\\n]{0,40}|не сохран[^\\n]{0,40}|сохран[^\\n]{0,30}/gi)").catch(() => null);
  await SP.click(byLabel("Свернуть задание")).catch(() => {});
  return { ok: saved.ok && rows === 1, saveMs: saved.ok ? saved.ms : null, rows, ui, target };
}
rec("answer save 503 ×2: autosave retries, answer persisted once", await answerOne("503", () => SI.add("POST", /\/responses$/, "status", { status: 503, times: 2 })));
rec("answer save connection reset: retried and persisted", await answerOne("reset", () => SI.add("POST", /\/responses$/, "fail")));
const lastAnswer = await answerOne("lost", () => SI.add("POST", /\/responses$/, "lostResp"));
rec("answer save response lost (server saved): retry idempotent, 1 row", lastAnswer);

// ── задание: загрузка при отказах (AFTER: c3cc51f) ──
const collapse = async () => { await SP.click(byLabel("Свернуть задание")).catch(() => {}); await sleep(700); };
const retryBtn = () => SP.eval(`!!${byText("button", "Повторить")}`).catch(() => false);
const collapseInError = () => SP.eval(`!!${byLabel("Свернуть задание")}`).catch(() => false);
async function matCase(label, { inject, cutSec = 0, waitMs = 60000 } = {}) {
  await SI.clear(); await collapse();
  if (inject) await inject();
  const t0 = Date.now();
  if (cutSec) { await L.cut("student", true); }
  await openActivity();
  if (cutSec) { await sleep(cutSec * 1000); await L.cut("student", false); }
  const r = await waitFor(async () => (await activityState()) === "ok", waitMs, 500);
  const res = { ok: r.ok, ms: r.ok ? Date.now() - t0 : null, sawError: null, f5: false };
  return res;
}
{
  const r1 = await matCase("reset", { inject: () => SI.add("GET", /\/activities\/[^/]+\/my$/, "fail") });
  rec("material load connection reset: recovers by itself, no F5", r1);
  const r2 = await matCase("delay", { inject: () => SI.add("GET", /\/activities\/[^/]+\/my$/, "delay", { ms: 35000 }), waitMs: 75000 });
  rec("material load delayed 35 s (> client timeout): recovers by itself", r2);
  const r3 = await matCase("outage", { cutSec: 12, waitMs: 60000 });
  rec("material load during 12 s network outage: recovers after network returns", r3);
  // повторы исчерпаны → честная ошибка с «Повторить» и «Свернуть»; клик загружает
  await SI.clear(); await collapse();
  await SI.add("GET", /\/activities\/[^/]+\/my$/, "status", { status: 503, times: 5 });
  await openActivity();
  const err = await waitFor(async () => (await activityState()) === "error", 60000, 500);
  const hasRetry = await retryBtn(), hasCollapse = await collapseInError();
  const errText = await SP.eval("(document.body.innerText.match(/Не удалось загрузить задание[^\\n]*/)||[''])[0]").catch(() => "");
  await SP.click(byText("button", "Повторить"));
  const afterClick = await waitFor(async () => (await activityState()) === "ok", 30000, 500);
  rec("material: retries exhausted → error with Retry + Collapse, Retry loads", { ok: err.ok && hasRetry && hasCollapse && afterClick.ok, errorAfterMs: err.ok ? err.ms : null, hasRetry, hasCollapse, errText, loadedAfterClickMs: afterClick.ok ? afterClick.ms : null });
  // событие online запускает повтор без клика
  await SI.clear(); await collapse();
  await SI.add("GET", /\/activities\/[^/]+\/my$/, "status", { status: 503, times: 5 });
  await openActivity();
  const err2 = await waitFor(async () => (await activityState()) === "error", 60000, 500);
  await SP.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(1500);
  await SP.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const viaOnline = await waitFor(async () => (await activityState()) === "ok", 20000, 500);
  rec("material: 'online' event retries automatically (no click, no F5)", { ok: err2.ok && viaOnline.ok, errorShown: err2.ok, loadedAfterOnlineMs: viaOnline.ok ? viaOnline.ms : null });
  // уже введённый ответ на месте после всех перезагрузок задания
  const t = lastAnswer.target;
  let kept = null;
  if (t) {
    for (let i = 0; i < 20 && kept === null; i++) {
      kept = await SP.eval(`(() => { const r = ${radioSel(t)}.filter(x => x.closest('label')?.getBoundingClientRect().width > 0); return r.length ? r.some(x => x.checked) : null; })()`).catch(() => null);
      if (kept === null) { await SP.click(byLabel("Следующая страница")); await sleep(1000); }
    }
  }
  const dbKept = t ? await count(`select count(*) from responses where question_id='${t.name.slice(2)}' and participant_id in (select id from lesson_participants where guest_id::text='${sid}' or user_id::text='${sid}') and response::text like '%${savedFragment(t)}%'`) : 0;
  rec("material: previously entered answer preserved after reloads", { ok: kept === true && dbKept === 1, radioChecked: kept, dbRows: dbKept });
  await SI.clear(); await collapse();
}

// 5. refresh: 401 на запрос → обновление токена и повтор; refresh 503 → вход НЕ сбрасывается
{
  const before = (TI.hits || []).length;
  await TI.add("GET", /\/lessons\/[^/]+\/chat$/, "status", { status: 401 });
  // ресинхрон чата запросит /chat (переоткрываем урок через reload учителя)
  await TP.reload(); await sleep(1500);
  await waitFor(async () => (await TP.eval(`!!${byLabel("Чат")}`)) || TP.eval(`!!${byText("button", "Присоединиться")}`), 40000);
  if (!(await TP.eval(`!!${byLabel("Чат")}`))) await TP.click(byText("button", "Присоединиться"));
  const inRoom = await waitFor(() => TP.eval(`!!${byLabel("Чат")}`), 40000);
  const onLogin = await TP.eval("location.pathname.startsWith('/login')");
  rec("401 on API → silent refresh, user stays in lesson", { ok: inRoom.ok && !onLogin, onLogin });
  await TI.add("POST", /\/auth\/refresh$/, "status", { status: 503, times: 3 });
  await TI.add("GET", /\/lessons\/[^/]+\/chat$/, "status", { status: 401 });
  await TP.reload(); await sleep(6000);
  const onLogin2 = await TP.eval("location.pathname.startsWith('/login')");
  await TI.clear();
  rec("refresh 503 (server down): user NOT logged out", { ok: !onLogin2, onLogin: onLogin2, path: await TP.eval("location.pathname") });
}
mark("rest done");
L.writeSummary({ suite: "rest", rounds: RESULTS, injections: { teacher: TI.hits, student: SI.hits } });
process.exit(0);
