// 2026-10-24: анимация частей иконок нижней панели. В безголовом Chrome
// (hover: hover) and (pointer: fine) ложно — копируем правила этого @media без
// условия и наводим на каждую кнопку панели. Проверяем: у каждой кнопки панели
// при наведении анимируются части SVG; в шапке анимаций нет. Кадры крупным планом.
import fs from "node:fs";
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, byLabel } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
check("teacher joins", await teacherJoin(T, { cam: true, mic: true }));
await resetLesson(T);
check("s1 joins", await guestEnter(S, "Юля Тестова", { cam: false, mic: false }));
const UNGATE = `(() => { let css = ''; for (const ss of document.styleSheets) { let rules; try { rules = ss.cssRules; } catch { continue; } for (const r of rules) if (r.media && /pointer: fine/.test(r.media.mediaText) && /prefers-reduced-motion/.test(r.media.mediaText)) for (const x of r.cssRules) css += x.cssText + '\\n'; } const s = document.createElement('style'); s.textContent = css; document.head.append(s); return css.split('\\n').length; })()`;
const BTNS = (scope) => `[...document.querySelectorAll('${scope} button')].filter(b => b.getBoundingClientRect().width > 0 && b.querySelector('svg.lucide')).map(b => { const r = b.getBoundingClientRect(); const s = b.querySelector('svg.lucide'); const sr = s.getBoundingClientRect(); return { label: b.getAttribute('aria-label') || b.innerText.trim(), icon: [...s.classList].find(c => c.startsWith('lucide-') && c !== 'lucide'), x: r.x + r.width / 2, y: r.y + r.height / 2, clip: { x: Math.max(0, sr.x - 6), y: Math.max(0, sr.y - 6), width: sr.width + 12, height: sr.height + 12, scale: 4 } }; })`;
const PARTS = (label) => `(() => { const b = [...document.querySelectorAll('button')].find(e => (e.getAttribute('aria-label') || e.innerText.trim()) === ${JSON.stringify(label)} && e.getBoundingClientRect().width > 0); const s = b.querySelector('svg.lucide'); return [s, ...s.children].map((e, i) => ({ i, anim: getComputedStyle(e).animationName, t: getComputedStyle(e).transform, dash: getComputedStyle(e).strokeDashoffset })).filter(x => x.anim !== 'none'); })()`;
const frames = {};
async function sweep(p, who, w, h, mobile) {
  await p.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await sleep(1500);
  mark(`${who}-${w} rules injected`, await p.eval(UNGATE));
  for (const b of await p.eval(BTNS("footer"))) {
    await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b.x, y: b.y });
    const shots = [];
    let parts = [];
    for (const ms of [40, 120, 220, 380]) {
      await sleep(ms - (shots.length ? [40, 120, 220, 380][shots.length - 1] : 0));
      if (ms === 120) parts = await p.eval(PARTS(b.label));
      const img = await p.send("Page.captureScreenshot", { format: "png", clip: b.clip }).catch(() => null);
      if (img?.data) { const f = `${process.env.OUT}/shots/${who}-${w}-${(b.icon || "x")}-${ms}.png`; fs.mkdirSync(`${process.env.OUT}/shots`, { recursive: true }); fs.writeFileSync(f, Buffer.from(img.data, "base64")); shots.push(f); }
    }
    const moving = parts.filter((x) => x.i > 0 || x.anim.includes("wave"));
    mark(`${who}-${w} ${b.label} [${b.icon}]`, parts);
    check(`${who}-${w} «${b.label}» (${b.icon}): parts animate (${moving.length})`, moving.length >= 1, parts);
    await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 300 });
    await sleep(650);
  }
  // В шапке и на плитках анимаций нет.
  for (const b of (await p.eval(BTNS("header"))).slice(0, 2)) {
    await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b.x, y: b.y });
    await sleep(120);
    const parts = await p.eval(PARTS(b.label));
    check(`${who}-${w} header «${b.label}»: no icon animation`, parts.length === 0, parts);
  }
}
await sweep(T, "teacher", 1440, 900, false);
await T.click(byLabel("Микрофон")); await T.click(byLabel("Камера")); await sleep(1200);
await T.eval(`location.reload()`); await sleep(6000);
await sweep(T, "teacher-off", 1440, 900, false);
await sweep(S, "student", 1440, 900, false);
await sweep(S, "student", 390, 844, true);
await finish();
