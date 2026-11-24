// Обход сервиса по ролям перед запуском рекламы (2026-11-24). Только стенд
// (своя БД, свой LiveKit), запускается с хоста: `node s72-walk.mjs`.
// Регистрация репетитора и школы через интерфейс, подтверждение почты — своим
// токеном в БД стенда (письма стенд не шлёт), обход страниц каждой роли,
// лимиты бесплатного тарифа, тестовая оплата, ученики по ссылке.
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { connectBrowser, openPage, sleep } from "./cdp.mjs";

const ORIGIN = process.env.ORIGIN || "http://172.31.0.1:3100";
const CDP = process.env.CDP;
const OUT = process.env.OUT;
fs.mkdirSync(`${OUT}/shots`, { recursive: true });
const RUN = Date.now().toString(36);
const T0 = Date.now();
const events = fs.createWriteStream(`${OUT}/events.jsonl`);
const issues = [];
const report = [];
const log = (e) => {
  e.rel = ((Date.now() - T0) / 1000).toFixed(1);
  events.write(JSON.stringify(e) + "\n");
  if (["console.error", "exception", "http5xx", "http4xx", "net.fail"].includes(e.kind)) issues.push(e);
};
const note = (section, text, extra) => {
  report.push({ section, text, extra });
  console.log(`[${section}] ${text}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400));
};

function psql(q) {
  return execFileSync("docker", ["exec", "znat-stage-postgres-1", "psql", "-U", "school", "-d", "school_dev", "-At", "-c", q]).toString().trim();
}
function verifyToken(email) {
  const tok = crypto.randomBytes(24).toString("hex");
  const hash = crypto.createHash("sha256").update(tok).digest("hex");
  psql(`insert into email_verification_tokens (user_id, token_hash, expires_at) select id, '${hash}', now() + interval '1 day' from users where lower(email) = lower('${email}')`);
  return tok;
}

const browser = await connectBrowser(CDP);
async function newPage(name) {
  const { browserContextId } = await browser.call("Target.createBrowserContext");
  const p = await openPage(browser, name, log, browserContextId);
  await p.send("Browser.grantPermissions", { browserContextId, origin: ORIGIN, permissions: ["audioCapture", "videoCapture"] }).catch(() => {});
  p.ctx = browserContextId;
  return p;
}
const waitFor = async (fn, ms = 20000) => {
  const s = Date.now();
  while (Date.now() - s < ms) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(400);
  }
  return null;
};
const text = (p) => p.eval("document.body.innerText").catch(() => "");
const path = (p) => p.eval("location.pathname + location.search").catch(() => "");
async function shot(p, name, mobile = false) {
  if (mobile) await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(mobile ? 1200 : 0);
  await p.shot(`${OUT}/shots/${name}${mobile ? "-m" : ""}.png`).catch(() => {});
  if (mobile) await p.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
}
async function visit(p, role, url, name, { mobile = false } = {}) {
  const before = issues.length;
  const t = Date.now();
  await p.goto(`${ORIGIN}${url}`);
  await waitFor(() => p.eval("document.readyState === 'complete' && document.body.innerText.length > 40"), 20000);
  await sleep(2500);
  const ms = Date.now() - t;
  const landed = await path(p);
  const body = (await text(p)).replace(/\n{2,}/g, "\n").slice(0, 1800);
  await shot(p, `${role}-${name}`);
  if (mobile) await shot(p, `${role}-${name}`, true);
  const errs = issues.slice(before).map((e) => `${e.kind} ${e.status || ""} ${e.method || ""} ${(e.url || e.text || "").slice(0, 120)}`);
  fs.writeFileSync(`${OUT}/${role}-${name}.txt`, `${url} -> ${landed}\n${body}`);
  note(role, `${url} -> ${landed} (${ms} мс)`, errs.length ? errs : undefined);
  return { landed, body };
}
async function api(p, method, apiPath, body) {
  return p.eval(`(async () => {
    const r = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" }).then(r => r.json()).catch(() => ({}));
    const res = await fetch("/api/v1${apiPath}", { method: ${JSON.stringify(method)}, credentials: "include",
      headers: Object.assign({ authorization: "Bearer " + r.accessToken }, ${body === undefined ? "{}" : '{ "content-type": "application/json" }'}),
      body: ${body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body))} });
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  })()`, 30000);
}
async function fill(p, selector, value) {
  await p.click(`document.querySelector(${JSON.stringify(selector)})`);
  await p.type(value);
}
async function login(p, email, pw) {
  await p.goto(`${ORIGIN}/login`);
  await waitFor(() => p.eval("!!document.querySelector('input[type=email]')"));
  await fill(p, "input[type=email]", email);
  await fill(p, "input[type=password]", pw);
  await p.click("document.querySelector('button[type=submit]')");
  return waitFor(async () => { const x = await path(p); return x !== "/login" ? x : null; }, 20000);
}
async function verifyAndLand(p, email) {
  const tok = verifyToken(email);
  await p.goto(`${ORIGIN}/verify-email?token=${tok}`);
  await sleep(4000);
  return path(p);
}
const byText = (sel, t) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.getBoundingClientRect().width > 0 && (e.textContent||'').trim().includes(${JSON.stringify(t)}))`;
const byLabel = (l) => `[...document.querySelectorAll('[aria-label]')].find(e => e.getBoundingClientRect().width > 0 && e.getAttribute('aria-label') === ${JSON.stringify(l)})`;
async function enterRoom(p, { cam = false, mic = false } = {}) {
  const ok = await waitFor(() => p.eval(`!!${byText("button", "Присоединиться")} || !!${byLabel("Чат")}`), 30000);
  if (!ok) return false;
  if (!(await p.eval(`!!${byLabel("Чат")}`))) {
    await sleep(1200);
    for (const [label, want] of [["Камера", cam], ["Микрофон", mic]]) {
      const st = await p.eval(`(() => { const b = ${byLabel(label)}; return b ? b.getAttribute('aria-pressed') : null; })()`);
      if (st !== null && (st === "true") !== want) await p.click(byLabel(label));
    }
    await p.click(byText("button", "Присоединиться"));
  }
  return !!(await waitFor(() => p.eval(`!!${byLabel("Чат")}`), 30000));
}
async function guestJoin(p, joinPath, name) {
  await p.goto(`${ORIGIN}${joinPath}`);
  const r = await waitFor(() => p.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]') || !!${byText("button", "Присоединиться")} || document.body.innerText.length > 200`), 30000);
  if (await p.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`)) {
    await fill(p, 'input[placeholder="Имя и фамилия"]', name);
    await p.click(`document.querySelector('[role=checkbox]')`);
    await sleep(300);
    await p.click("document.querySelector('button[type=submit]')");
  }
  const inside = await enterRoom(p);
  await sleep(2500);
  return { r: !!r, inside, body: (await text(p)).slice(0, 400) };
}

const PW = "Stage-pass-2026";
try {
  // ── Публичные страницы (стенд отдаёт только приложение; лендинг — Caddy прода) ──
  const pub = await newPage("public");
  for (const [u, n] of [["/login", "login"], ["/register", "register"], ["/register/individual", "register-individual"], ["/register/organization", "register-org"], ["/forgot-password", "forgot"], ["/terms", "terms"], ["/privacy", "privacy"], ["/requisites", "requisites"]]) {
    await visit(pub, "public", u, n, { mobile: ["register", "register-individual", "login"].includes(n) });
  }

  // ── Репетитор: регистрация через форму ──
  const tutorEmail = `tutor-${RUN}@stage.test`;
  const T = await newPage("tutor");
  await T.goto(`${ORIGIN}/register/individual`);
  await waitFor(() => T.eval("!!document.querySelector('#reg-name')"));
  await fill(T, "#reg-name", "Анна Репетитор");
  await fill(T, "#reg-email", tutorEmail);
  await fill(T, "#reg-password", PW);
  await T.click("document.querySelector('[role=checkbox]')");
  await sleep(300);
  await T.click("document.querySelector('button[type=submit]')");
  const afterReg = await waitFor(async () => { const x = await path(T); return x.includes("check-email") ? x : null; }, 15000);
  await shot(T, "tutor-01-check-email");
  note("tutor", `регистрация -> ${afterReg || (await path(T))}`, (await text(T)).slice(0, 300));
  const landed = await verifyAndLand(T, tutorEmail);
  await shot(T, "tutor-02-after-verify");
  note("tutor", `после подтверждения почты -> ${landed}`, (await text(T)).slice(0, 500));
  if (!landed.startsWith("/lessons")) note("tutor", `вход после подтверждения: ${await login(T, tutorEmail, PW)}`);

  for (const [u, n] of [["/lessons", "lessons"], ["/materials", "materials"], ["/recordings", "recordings"], ["/billing", "billing"], ["/account/password", "password"], ["/admin/members", "members"], ["/admin/settings", "settings"], ["/platform", "platform"], ["/materials/edit", "materials-edit"]]) {
    await visit(T, "tutor", u, n, { mobile: ["lessons", "billing"].includes(n) });
  }
  const me = await api(T, "GET", "/auth/me");
  note("tutor", "auth/me", me.data && { roles: me.data.roles, role: me.data.role, kind: me.data.space?.kind ?? me.data.schoolKind });
  const billing0 = await api(T, "GET", "/billing");
  note("tutor", "billing до оплаты", billing0.data && { plan: billing0.data.plan, limits: billing0.data.limits, usage: billing0.data.usage, testMode: billing0.data.testMode });
  const lessons0 = await api(T, "GET", "/lessons");
  const list = Array.isArray(lessons0.data) ? lessons0.data : lessons0.data?.lessons ?? lessons0.data?.items ?? [];
  note("tutor", `аудиторий после регистрации: ${list.length}`, list.slice(0, 2).map((l) => Object.keys(l)));
  const create2 = await api(T, "POST", "/lessons", { title: "Вторая аудитория" });
  note("tutor", "создать ещё аудиторию на бесплатном", { status: create2.status, data: create2.data });

  let lesson = list[0];
  if (!lesson && create2.status === 201) lesson = create2.data;
  if (lesson) {
    const full = await api(T, "GET", `/lessons/${lesson.id}`);
    fs.writeFileSync(`${OUT}/tutor-lesson.json`, JSON.stringify(full.data, null, 2));
    const code = full.data?.joinCode ?? full.data?.code ?? full.data?.shortCode;
    const joinPath = code ? `/${code}` : full.data?.joinUrl ? new URL(full.data.joinUrl).pathname : null;
    note("tutor", `ссылка ученика: ${joinPath ? "есть" : "НЕ НАЙДЕНА"}`, Object.keys(full.data || {}));

    // Учитель входит в урок
    await T.goto(`${ORIGIN}/lessons/${lesson.id}/room`);
    const tin = await enterRoom(T, { cam: true, mic: true });
    await sleep(3000);
    await shot(T, "tutor-room");
    note("tutor", `учитель в уроке: ${tin}`);

    if (joinPath) {
      const guests = [];
      for (let i = 1; i <= 4; i++) {
        const g = await newPage(`g${i}`);
        const r = await guestJoin(g, joinPath, `Ученик ${i}`);
        guests.push(g);
        await shot(g, `guest-${i}`, i === 1);
        note("guest", `ученик ${i} на бесплатном: в уроке=${r.inside}`, r.inside ? undefined : r.body);
      }
      await shot(T, "tutor-room-with-guests");

      // Тестовая оплата «Репетитора»
      const co = await api(T, "POST", "/billing/checkout", { plan: "tutor", period: "month" });
      note("billing", "checkout tutor/month", { status: co.status, data: co.data });
      const payUrl = co.data?.url || co.data?.paymentUrl || co.data?.redirectUrl;
      if (payUrl) {
        const P = await newPage("pay");
        // Тестовая форма — внутри приложения, под той же сессией: открываем во вкладке учителя.
        await T.goto(payUrl.startsWith("http") ? payUrl : `${ORIGIN}${payUrl}`);
        await sleep(3000);
        await shot(T, "billing-test-pay");
        note("billing", `тестовая форма: ${await path(T)}`, (await text(T)).slice(0, 400));
        const payBtn = await T.eval(`(() => { const b = [...document.querySelectorAll('button')].find(b => /оплат|успеш|подтверд/i.test(b.textContent||'')); if (!b) return null; return b.textContent.trim(); })()`);
        if (payBtn) {
          await T.click(`[...document.querySelectorAll('button')].find(b => /оплат|успеш|подтверд/i.test(b.textContent||''))`);
          await sleep(5000);
          await shot(T, "billing-after-pay");
          note("billing", `после нажатия «${payBtn}» -> ${await path(T)}`, (await text(T)).slice(0, 500));
        }
        void P;
      }
      const billing1 = await api(T, "GET", "/billing");
      note("billing", "billing после оплаты", billing1.data && { plan: billing1.data.plan, paidUntil: billing1.data.paidUntil, limits: billing1.data.limits, lastPayment: billing1.data.lastPayment });
      await visit(T, "tutor", "/billing", "billing-paid");
      const g5 = await newPage("g5");
      const r5 = await guestJoin(g5, joinPath, "Ученик 5");
      note("guest", `ученик 5 после оплаты: в уроке=${r5.inside}`, r5.inside ? undefined : r5.body);
      const create3 = await api(T, "POST", "/lessons", { title: "Ещё аудитория" });
      note("tutor", "создать аудиторию на «Репетиторе»", { status: create3.status, data: create3.data });
      for (const g of [...guests, g5]) await g.goto("about:blank").catch(() => {});
    }
    await T.goto("about:blank");
  }

  // ── Школа: регистрация через форму (два шага) ──
  const adminEmail = `school-${RUN}@stage.test`;
  const A = await newPage("admin");
  await A.goto(`${ORIGIN}/register/organization`);
  await waitFor(() => A.eval("!!document.querySelector('input')"));
  await shot(A, "org-01-step1");
  const step1 = await A.eval(`[...document.querySelectorAll('input')].filter(i=>i.getBoundingClientRect().width>0).map(i=>i.id||i.name||i.placeholder)`);
  note("admin", "шаг 1 формы школы", step1);
  for (const [sel, v] of [["#org-name", "Школа Стенд"], ["#org-inn", "7707083893"], ["#org-ogrn", "1027700132195"]]) {
    if (await A.eval(`!!document.querySelector(${JSON.stringify(sel)})`)) await fill(A, sel, v);
  }
  await A.click(`[...document.querySelectorAll('button')].find(b => /дальше|далее|продолж/i.test(b.textContent||''))`);
  await sleep(800);
  for (const [sel, v] of [["#org-fullname", "Ирина Админ"], ["#org-email", adminEmail], ["#org-password", PW]]) {
    if (await A.eval(`!!document.querySelector(${JSON.stringify(sel)})`)) await fill(A, sel, v);
  }
  await A.click("document.querySelector('[role=checkbox]')");
  await sleep(300);
  await A.click("document.querySelector('button[type=submit]')");
  const orgReg = await waitFor(async () => { const x = await path(A); return x.includes("check-email") ? x : null; }, 15000);
  await shot(A, "org-02-submitted");
  note("admin", `регистрация школы -> ${orgReg || (await path(A))}`, orgReg ? undefined : (await text(A)).slice(0, 500));
  const aLanded = await verifyAndLand(A, adminEmail);
  note("admin", `после подтверждения -> ${aLanded}`);
  if (!aLanded.startsWith("/lessons")) note("admin", `вход: ${await login(A, adminEmail, PW)}`);
  for (const [u, n] of [["/lessons", "lessons"], ["/admin/members", "members"], ["/admin/invites", "invites"], ["/admin/settings", "settings"], ["/admin/recordings", "recordings"], ["/materials", "materials"], ["/materials/edit", "materials-edit"], ["/billing", "billing"], ["/platform", "platform"]]) {
    await visit(A, "admin", u, n, { mobile: ["lessons", "billing"].includes(n) });
  }
  const ab = await api(A, "GET", "/billing");
  note("admin", "billing школы", ab.data && { plan: ab.data.plan, limits: ab.data.limits, usage: ab.data.usage });
  const l1 = await api(A, "POST", "/lessons", { title: "Математика 7А" });
  note("admin", "создать первую аудиторию", { status: l1.status, title: l1.data?.title, msg: l1.data?.message });
  const l2 = await api(A, "POST", "/lessons", { title: "Физика 8Б" });
  note("admin", "создать вторую аудиторию на бесплатном", { status: l2.status, msg: l2.data?.message ?? l2.data?.error });
  const invT = await api(A, "POST", "/invites", { role: "teacher" });
  note("admin", "приглашение учителя", { status: invT.status, msg: invT.data?.message });
  const invM = await api(A, "POST", "/invites", { role: "methodist" });
  note("admin", "приглашение методиста на бесплатном", { status: invM.status, msg: invM.data?.message ?? invM.data?.error });
  const coS = await api(A, "POST", "/billing/checkout", { plan: "school", period: "month" });
  note("admin", "оплата школьного тарифа (скрыт)", { status: coS.status, msg: coS.data?.message ?? coS.data?.error });

  if (invT.data?.url) {
    const teacherEmail = `teacher-${RUN}@stage.test`;
    const Tc = await newPage("teacher");
    const invPath = new URL(invT.data.url, ORIGIN).pathname;
    await visit(Tc, "teacher", invPath, "invite", { mobile: true });
    const inputs = await Tc.eval(`[...document.querySelectorAll('input')].filter(i=>i.getBoundingClientRect().width>0).map(i=>({id:i.id,type:i.type,ph:i.placeholder}))`);
    note("teacher", "поля приглашения", inputs);
    const vis = inputs.filter((i) => i.type !== "checkbox");
    const vals = { email: teacherEmail, password: PW };
    for (const i of vis) {
      const v = i.type === "email" ? vals.email : i.type === "password" ? vals.password : "Пётр Учитель";
      await fill(Tc, i.id ? `#${i.id}` : `input[placeholder="${i.ph}"]`, v);
    }
    if (await Tc.eval("!!document.querySelector('[role=checkbox]')")) await Tc.click("document.querySelector('[role=checkbox]')");
    await sleep(300);
    await Tc.click("document.querySelector('button[type=submit]')");
    await sleep(4000);
    note("teacher", `после регистрации по приглашению -> ${await path(Tc)}`, (await text(Tc)).slice(0, 300));
    const tl = await verifyAndLand(Tc, teacherEmail);
    note("teacher", `после подтверждения -> ${tl}`);
    if (!tl.startsWith("/lessons")) note("teacher", `вход: ${await login(Tc, teacherEmail, PW)}`);
    for (const [u, n] of [["/lessons", "lessons"], ["/materials", "materials"], ["/recordings", "recordings"], ["/billing", "billing"], ["/admin/members", "members"], ["/materials/edit", "materials-edit"]]) {
      await visit(Tc, "teacher", u, n);
    }
    const tme = await api(Tc, "GET", "/auth/me");
    note("teacher", "auth/me", tme.data && { roles: tme.data.roles, role: tme.data.role });
    const inv2 = await api(A, "POST", "/invites", { role: "teacher" });
    note("admin", "второй учитель на бесплатном (лимит 1)", { status: inv2.status, msg: inv2.data?.message ?? inv2.data?.error });
  }
  await visit(A, "admin", "/admin/members", "members-after");

  // ── Супер-админ ──
  const S = await newPage("super");
  const sup = await S.eval(`fetch("/api/v1/auth/register/individual", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fullName: "Супер Админ", email: "super@stage.test", password: ${JSON.stringify(PW)}, personalDataConsent: true }) }).then(r => r.status)`);
  note("super", `регистрация super@stage.test: ${sup}`);
  const sl = await verifyAndLand(S, "super@stage.test");
  if (!sl.startsWith("/")) note("super", "вход", await login(S, "super@stage.test", PW));
  for (const [u, n] of [["/platform", "platform"], ["/lessons", "lessons"]]) await visit(S, "super", u, n);
} catch (err) {
  note("error", String(err?.stack || err));
} finally {
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ report, issues }, null, 2));
  events.end();
  console.log(`\nissues: ${issues.length}`);
  setTimeout(() => process.exit(0), 500);
}
