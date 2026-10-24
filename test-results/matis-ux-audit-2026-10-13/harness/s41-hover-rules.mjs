// 2026-10-24: правила анимации иконок в сборке и их срабатывание. В безголовом
// Chrome (hover: hover) and (pointer: fine) ложно и не эмулируется, поэтому
// копируем правила из этого @media без условия «мышь» и наводим.
import { resetLesson, openBrowsers, P, teacherJoin, check, finish, sleep, mark, shot } from "./lib.mjs";
await openBrowsers(["teacher"]);
const T = P.teacher;
await T.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
check("teacher joins", await teacherJoin(T, { cam: true, mic: true }));
await resetLesson(T);
const found = await T.eval(`(() => { const out = []; for (const ss of document.styleSheets) { let rules; try { rules = ss.cssRules; } catch { continue; } for (const r of rules) { if (r.media && /hover: hover/.test(r.media.mediaText)) { out.push({ media: r.media.mediaText, n: r.cssRules.length, sample: r.cssRules[0]?.cssText.slice(0, 120) }); } } } return out; })()`);
mark("hover media rules in bundle", found);
check("icon hover rules shipped", found.some((f) => /pointer: fine/.test(f.media) && f.n >= 5), found);
await T.eval(`(() => { let css = ''; for (const ss of document.styleSheets) { let rules; try { rules = ss.cssRules; } catch { continue; } for (const r of rules) if (r.media && /pointer: fine/.test(r.media.mediaText) && /prefers-reduced-motion/.test(r.media.mediaText)) for (const x of r.cssRules) css += x.cssText + '\\n'; } const s = document.createElement('style'); s.textContent = css; document.head.append(s); return css.length; })()`);
const BTNS = `[...document.querySelectorAll('.room-ctl')].filter(b => b.getBoundingClientRect().width > 0).map(b => { const r = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label'), x: r.x + r.width / 2, y: r.y + r.height / 2 }; })`;
for (const b of await T.eval(BTNS)) {
  await T.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b.x, y: b.y });
  await sleep(110);
  const st = await T.eval(`(() => { const btn = [...document.querySelectorAll('.room-ctl')].find(e => e.getAttribute('aria-label') === ${JSON.stringify(b.label)}); const i = btn.querySelector('[data-icon-motion]'); return { motion: i?.dataset.iconMotion, anim: i ? getComputedStyle(i).animationName : null, transform: i ? getComputedStyle(i).transform : null }; })()`);
  mark(`hover ${b.label}`, st);
  check(`«${b.label}»: ${st.motion} plays on hover`, st.anim && st.anim !== "none" && st.transform !== "none", st);
  if (b.label === "Микрофон") await shot(T, "hover-mic");
  await T.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 300 });
  await sleep(600);
}
await finish();
