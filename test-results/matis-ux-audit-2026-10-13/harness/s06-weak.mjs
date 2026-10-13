// Слабое устройство и плохая сеть: ученик с CPU ×6 и BAD_3G; учитель показывает экран.
// Что видит каждый, отзывается ли интерфейс, понимает ли человек, почему хуже.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, waitFor, ui, finish, sleep, shot, mark, flow, hears, profile, clearNet, press, SHARE, labelOf, sendChat, countText, log } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await teacherJoin(T); await resetLesson(T);
check("s1 joins", await guestEnter(S, "Ученик Слабый"));
await sleep(4000);
const responsiveness = async (p) => { const t0 = Date.now(); await p.eval("1"); return Date.now() - t0; };
const longTasks = (p) => p.eval(`(() => { if (!window.__lt) { window.__lt = []; new PerformanceObserver(l => window.__lt.push(...l.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: true }); } const a = window.__lt.splice(0); return { n: a.length, max: Math.round(Math.max(0, ...a)), sum: Math.round(a.reduce((x, y) => x + y, 0)) }; })()`);
await longTasks(S); await longTasks(T);

mark("1. CPU ученика ×6 (без сети)");
await S.send("Emulation.setCPUThrottlingRate", { rate: 6 });
await sleep(20000);
const f1 = await flow(S);
const lt1 = await longTasks(S);
const r1 = await responsiveness(S);
check("weak CPU: student still hears teacher", hears(f1), f1);
log({ kind: "info", text: "weak CPU long tasks / eval latency", extra: { lt1, r1 } });
const msg = `cpu-${Date.now() % 100000}`; const t0 = Date.now();
await sendChat(S, msg);
const d = await waitFor(async () => (await countText(T, msg)) >= 1, 15000);
check("weak CPU: chat send works", d.ok, { ms: Date.now() - t0 });
await shot(S, "weak-cpu");

mark("2. + учитель показывает экран");
await press(T, SHARE.off);
await waitFor(async () => (await labelOf(T, [SHARE.on])) === SHARE.on, 20000);
await sleep(20000);
const f2 = await flow(S);
const lt2 = await longTasks(S);
check("weak CPU + share: student hears teacher", hears(f2), f2);
check("weak CPU + share: student sees screen", await S.eval(`!!document.body.innerText.match(/показывает экран/)`));
log({ kind: "info", text: "weak CPU + share long tasks", extra: lt2 });
const tele = await S.eval(`document.body.innerText.includes('Плохая связь') || document.body.innerText.includes('плохая связь')`);
log({ kind: "info", text: "student sees any quality hint", extra: { tele, ui: await ui(S) } });
await shot(S, "weak-cpu-share");

mark("3. + плохая сеть BAD_3G у ученика");
await profile("s1", "BAD_3G");
await sleep(30000);
const f3 = await flow(S);
const u3 = await ui(S);
const hint3 = await S.eval(`[...document.querySelectorAll('[aria-label]')].map(e=>e.getAttribute('aria-label')).filter(l => /связ|качеств|Плох/i.test(l))`);
check("bad net + weak CPU: student still hears teacher", hears(f3), f3);
log({ kind: "info", text: "bad net: what student sees", extra: { u3, hint3 } });
const tHint = await T.eval(`[...document.querySelectorAll('[aria-label]')].map(e=>e.getAttribute('aria-label')).filter(l => /связ|Плох/i.test(l))`);
log({ kind: "info", text: "teacher sees student's bad link", extra: tHint });
check("teacher sees that student's link is bad", tHint.length > 0, tHint);
await shot(S, "weak-badnet"); await shot(T, "weak-badnet");

mark("4. восстановление: сеть и CPU в норму");
await clearNet("s1"); await S.send("Emulation.setCPUThrottlingRate", { rate: 1 });
await sleep(30000);
const f4 = await flow(S);
check("after recovery: student video back", f4.inVideoFrames > 30, f4);
await press(T, SHARE.on);
await finish();
