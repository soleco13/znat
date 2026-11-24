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
// Новая страница «Тариф» (2026-11-24): оплаченный тариф, бесплатный, окно автопродления — ПК и телефон.
// WebGL в headless Chrome программный — 3D-знак уходит в плоский (так же, как у пользователя без видеокарты).
const RUNID = process.env.RUNID;
async function fullShot(p, name, w, mobile) {
  await p.send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await sleep(1500);
  const m = await p.send("Page.getLayoutMetrics");
  const h = Math.min(Math.ceil(m.cssContentSize.height), 4000);
  const { data } = await p.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } }, 30000);
  fs.writeFileSync(`${OUT}/shots/${name}.png`, Buffer.from(data, "base64"));
}
try {
  const T = await newPage("tutor");
  await login(T, `tutor-${RUNID}@stage.test`, PW);
  await T.goto(`${ORIGIN}/billing`); await sleep(4000);
  note("paid", (await text(T)).replace(/\n+/g, " | ").slice(0, 700));
  await fullShot(T, "paid-desktop", 1440, false);
  await T.goto(`${ORIGIN}/billing`); await sleep(3000);
  await fullShot(T, "paid-phone", 390, true);
  // бесплатный: новый репетитор
  const email = `free-${Date.now().toString(36)}@stage.test`;
  const F = await newPage("free");
  await F.goto(`${ORIGIN}/login`); await sleep(1500);
  const r = await F.eval(`fetch("/api/v1/auth/register/individual",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({fullName:"Ольга Новикова",email:${JSON.stringify(email)},password:${JSON.stringify(PW)},personalDataConsent:true})}).then(r=>r.status)`);
  note("free", `регистрация ${r}`);
  await verifyAndLand(F, email);
  await F.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await F.goto(`${ORIGIN}/billing`); await sleep(4000);
  note("free", (await text(F)).replace(/\n+/g, " | ").slice(0, 600));
  await fullShot(F, "free-desktop", 1440, false);
  await F.goto(`${ORIGIN}/billing`); await sleep(3000);
  await fullShot(F, "free-phone", 390, true);
  // окно автопродления
  await F.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await F.goto(`${ORIGIN}/billing`); await sleep(3500);
  await F.click(`[...document.querySelectorAll('button')].find(b => /Включить через СБП/.test(b.textContent||''))`); await sleep(1200);
  await F.shot(`${OUT}/shots/autopay-dialog.png`);
  note("issues", issues.map((e) => `${e.kind} ${e.status || ""} ${(e.url || e.text || "").slice(0, 100)}`));
} catch (err) {
  note("error", String(err?.stack || err));
} finally {
  events.end();
  setTimeout(() => process.exit(0), 500);
}
