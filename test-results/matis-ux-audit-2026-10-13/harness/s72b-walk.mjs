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
const RUNID = process.env.RUNID;
try {
  // ── Репетитор: ученики по ссылке на бесплатном, оплата, после оплаты ──
  const T = await newPage("tutor");
  note("tutor", `вход: ${await login(T, `tutor-${RUNID}@stage.test`, PW)}`);
  const ls = await api(T, "GET", "/lessons");
  const lesson = (Array.isArray(ls.data) ? ls.data : ls.data?.lessons ?? ls.data?.items ?? Object.values(ls.data || {}).find(Array.isArray) ?? [])[0];
  note("tutor", "lessons shape", { status: ls.status, keys: Object.keys(ls.data || {}) });
  const joinPath = lesson.joinPath;
  note("tutor", `ссылка ученика ${joinPath ? "есть" : "нет"}`);
  await T.goto(`${ORIGIN}/lessons/${lesson.id}/room`);
  note("tutor", `учитель в уроке: ${await enterRoom(T, { cam: true, mic: true })}`);
  const guests = [];
  for (let i = 1; i <= 4; i++) {
    const g = await newPage(`g${i}`);
    const r = await guestJoin(g, joinPath, `Ученик ${i}`);
    guests.push(g);
    await shot(g, `guest-${i}`, i === 1 || i === 4);
    note("guest", `ученик ${i} на бесплатном (лимит 3): в уроке=${r.inside}`, r.inside ? undefined : r.body);
  }
  await sleep(2000);
  await shot(T, "tutor-room-with-guests");
  const co = await api(T, "POST", "/billing/checkout", { plan: "tutor", period: "month" });
  note("billing", "checkout tutor/month", { status: co.status, data: co.data });
  const payUrl = co.data?.url || co.data?.paymentUrl || co.data?.redirectUrl || co.data?.confirmationUrl;
  const B = await newPage("billing");
  if (payUrl) {
    // Отдельная вкладка той же сессии нужна для тестовой формы: заходим тем же аккаунтом.
    await login(B, `tutor-${RUNID}@stage.test`, PW);
    await B.goto(payUrl.startsWith("http") ? payUrl : `${ORIGIN}${payUrl}`);
    await sleep(3000);
    await shot(B, "billing-test-pay");
    note("billing", `тестовая форма: ${await path(B)}`, (await text(B)).slice(0, 500));
    const btns = await B.eval(`[...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0).map(b=>b.textContent.trim())`);
    note("billing", "кнопки формы", btns);
    const ok = await B.click(`[...document.querySelectorAll('button')].find(b => b.getBoundingClientRect().width>0 && /оплатить|успешн|подтвердить/i.test(b.textContent||''))`);
    await sleep(5000);
    await shot(B, "billing-after-pay");
    note("billing", `нажата оплата=${ok} -> ${await path(B)}`, (await text(B)).slice(0, 600));
  }
  const b1 = await api(T, "GET", "/billing");
  note("billing", "после оплаты", b1.data && { plan: b1.data.plan, paidUntil: b1.data.paidUntil, limits: b1.data.limits, lastPayment: b1.data.lastPayment });
  await visit(B, "tutor", "/billing", "billing-paid", { mobile: true });
  // 4-й ученик ещё раз
  const g4 = guests[3];
  const r4 = await guestJoin(g4, joinPath, "Ученик 4");
  note("guest", `ученик 4 после оплаты: в уроке=${r4.inside}`, r4.inside ? undefined : r4.body);
  await shot(T, "tutor-room-after-pay");
  for (const g of guests) await g.goto("about:blank").catch(() => {});
  await T.goto("about:blank");

  // ── Школа: аудитория с учителем ──
  const A = await newPage("admin");
  note("admin", `вход: ${await login(A, `school-${RUNID}@stage.test`, PW)}`);
  const users = await api(A, "GET", "/users");
  const list = Array.isArray(users.data) ? users.data : users.data?.users ?? Object.values(users.data || {}).find(Array.isArray) ?? [];
  const teacher = list.find((u) => (u.roles || [u.role]).includes("teacher"));
  note("admin", `участники: ${list.length}`, list.map((u) => u.roles || u.role));
  const l1 = await api(A, "POST", "/lessons", { title: "Математика 7А", teacherId: teacher?.id });
  note("admin", "создать аудиторию", { status: l1.status, msg: l1.data?.message });
  const l2 = await api(A, "POST", "/lessons", { title: "Физика 8Б", teacherId: teacher?.id });
  note("admin", "вторая аудитория на бесплатном (лимит 1)", { status: l2.status, msg: l2.data?.message });
  await visit(A, "admin", "/lessons", "lessons-with-room", { mobile: true });
  const Tc = await newPage("teacher");
  note("teacher", `вход: ${await login(Tc, `teacher-${RUNID}@stage.test`, PW)}`);
  await visit(Tc, "teacher", "/lessons", "lessons-with-room", { mobile: true });
  await visit(Tc, "teacher", "/billing", "billing");

  // ── Супер-админ ──
  const S = await newPage("super");
  await S.goto(`${ORIGIN}/login`);
  await sleep(1500);
  const sup = await S.eval(`fetch("/api/v1/auth/register/individual", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fullName: "Супер Админ", email: "super@stage.test", password: ${JSON.stringify(PW)}, personalDataConsent: true }) }).then(r => r.status)`);
  note("super", `регистрация super@stage.test: ${sup}`);
  const sl = await verifyAndLand(S, "super@stage.test");
  note("super", `после подтверждения -> ${sl}`);
  for (const [u, n] of [["/platform", "platform"], ["/lessons", "lessons"]]) await visit(S, "super", u, n);
} catch (err) {
  note("error", String(err?.stack || err));
} finally {
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ report, issues }, null, 2));
  events.end();
  console.log(`\nissues: ${issues.length}`);
  setTimeout(() => process.exit(0), 500);
}
