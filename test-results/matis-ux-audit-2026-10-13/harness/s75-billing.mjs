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
// Полная страница (с прокруткой) и перечень того, на что можно нажать.
async function full(p, name) {
  const m = await p.send("Page.getLayoutMetrics");
  const h = Math.min(Math.ceil(m.cssContentSize?.height || m.contentSize.height), 6000);
  const w = Math.ceil(m.cssLayoutViewport?.clientWidth || 1280);
  const { data } = await p.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } }, 30000);
  fs.writeFileSync(`${OUT}/shots/${name}.png`, Buffer.from(data, "base64"));
}
const controls = (p) => p.eval(`[...document.querySelectorAll('button,a,[role=menuitem],[role=tab],input,select,textarea')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const t=(e.getAttribute('aria-label')||e.textContent||e.placeholder||e.value||'').trim().replace(/\\s+/g,' ').slice(0,50);return e.tagName.toLowerCase()+':'+t+(e.disabled?' [disabled]':'')}).filter((x,i,a)=>a.indexOf(x)===i)`).catch(() => []);
async function page(p, role, url, name, opts = {}) {
  if (url) { await p.goto(`${ORIGIN}${url}`); await sleep(3500); }
  await full(p, `${role}-${name}`);
  if (opts.mobile) {
    await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(1500);
    await full(p, `${role}-${name}-m`);
    await p.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
  }
  const c = await controls(p);
  const body = (await text(p)).replace(/\n{2,}/g, "\n");
  fs.writeFileSync(`${OUT}/${role}-${name}.txt`, `${await path(p)}\n--- controls\n${c.join("\n")}\n--- text\n${body}`);
  note(role, `${name}: ${await path(p)}, элементов ${c.length}`);
}
async function clickText(p, re) {
  return p.click(`[...document.querySelectorAll('button,a,[role=menuitem]')].find(e => e.getBoundingClientRect().width>0 && new RegExp(${JSON.stringify(re)}, 'i').test((e.getAttribute('aria-label')||'') + ' ' + (e.textContent||'')))`);
}
async function esc(p) { await p.key("Escape", "Escape", 27); await sleep(500); }
const RUNID = process.env.RUNID;
try {
  // ── Регистрация: организации закрыты ──
  const P = await newPage("public");
  await page(P, "public", "/register", "register", { mobile: true });
  await page(P, "public", "/register/organization", "register-org", { mobile: true });
  const orgApi = await P.eval(`fetch("/api/v1/auth/register/organization", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fullName: "Тест", email: "org-${RUNID}-2@stage.test", password: ${JSON.stringify(PW)}, orgName: "Школа 2", inn: "7707083893", ogrn: "1027700132195", personalDataConsent: true }) }).then(async r => ({ status: r.status, body: await r.json() }))`);
  note("public", "API регистрации ООО", orgApi);

  // ── Репетитор: оплата через страницу «Тариф» и история ──
  const T = await newPage("tutor");
  await login(T, `tutor-${RUNID}@stage.test`, PW);
  const nav = await T.eval(`[...document.querySelectorAll('nav a, aside a')].map(a => a.textContent.trim()).filter(Boolean)`);
  note("tutor", "меню", nav);
  await T.goto(`${ORIGIN}/billing`); await sleep(3000);
  await T.click(`[...document.querySelectorAll('button')].find(b => /Продлить|Оплатить/.test(b.textContent||''))`);
  await sleep(2500);
  note("billing", `форма: ${await path(T)}`);
  await T.click(`[...document.querySelectorAll('button')].find(b => /Оплатить .*\\(тест\\)/.test(b.textContent||''))`);
  await sleep(5000);
  await page(T, "tutor", null, "billing-after-pay", { mobile: true });
  // Автопродление: тестовая подписка — вторая строка истории
  const sub = await api(T, "POST", "/billing/subscribe", { plan: "tutor", period: "month", autopayConsent: true });
  if (sub.data?.url) {
    const u = new URL(sub.data.url);
    await T.goto(`${ORIGIN}${u.pathname}${u.search}`); await sleep(2500);
    await T.click(`[...document.querySelectorAll('button')].find(b => /Оплатить|Подписаться|Подтвердить/.test(b.textContent||'') && /тест/.test(b.textContent||''))`);
    await sleep(5000);
  }
  note("billing", "подписка", { status: sub.status, msg: sub.data?.message });
  await page(T, "tutor", "/billing", "billing-final", { mobile: true });
  const st = await api(T, "GET", "/billing");
  note("billing", "история", st.data?.payments);

  // ── Администратор школы: «Тарифа» нет ──
  const A = await newPage("admin");
  await login(A, `school-${RUNID}@stage.test`, PW);
  await sleep(2500);
  const anav = await A.eval(`[...document.querySelectorAll('nav a, aside a')].map(a => a.textContent.trim()).filter(Boolean)`);
  note("admin", "меню", anav);
  await A.goto(`${ORIGIN}/billing`); await sleep(3500);
  note("admin", `/billing -> ${await path(A)}`);
  const ab = await api(A, "GET", "/billing");
  note("admin", "API /billing", { status: ab.status, msg: ab.data?.message });
  // ── Учитель школы ──
  const Tc = await newPage("teacher");
  await login(Tc, `teacher-${RUNID}@stage.test`, PW);
  await Tc.goto(`${ORIGIN}/billing`); await sleep(3500);
  note("teacher", `/billing -> ${await path(Tc)}`);
} catch (err) {
  note("error", String(err?.stack || err));
} finally {
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ report, issues }, null, 2));
  events.end();
  console.log(`\nissues: ${issues.length}`);
  setTimeout(() => process.exit(0), 500);
}
