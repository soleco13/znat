// 2026-10-17: урок на телефоне — масштаб страницы заблокирован (щипок, двойной тап).
import { openBrowsers, shot, P, guestEnter, check, finish, sleep, waitFor, ORIGIN, JOIN, inRoom, mark } from "./lib.mjs";
await openBrowsers(["s1"]);
const M = P.s1;
await M.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await M.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
const scale = async () => { const m = await M.send("Page.getLayoutMetrics"); return m.cssVisualViewport?.scale ?? m.visualViewport?.scale ?? 1; };
const pinch = async () => {
  await M.send("Input.synthesizePinchGesture", { x: 195, y: 400, scaleFactor: 2.5, relativeSpeed: 800, gestureSourceType: "touch" }, 20000).catch((e) => mark("pinch err", String(e)));
  await sleep(800);
};
const dbltap = async () => {
  await M.send("Input.synthesizeTapGesture", { x: 195, y: 300, tapCount: 2, gestureSourceType: "touch" }, 20000).catch((e) => mark("tap err", String(e)));
  await sleep(800);
};

// Щипок в headless Chrome не масштабирует и обычную страницу (проверено) —
// здесь проверяем механизм: viewport, touch-action и что на другом экране его нет.
await M.goto(`${ORIGIN}/login`);
await sleep(1500);
check("login page not locked", !(await M.eval(`document.documentElement.classList.contains('no-page-zoom')`)) && !/user-scalable=no/.test(await M.eval(`document.querySelector('meta[name=viewport]').content`)));

await guestEnter(M, "Телефон Тест", { cam: false, mic: false });
const lessonUp = async () => /Тимур Учителев/.test(await M.eval("document.body.innerText"));
check("guest in lesson (mobile)", (await waitFor(lessonUp, 20000)).ok);
await shot(M, "after-enter");
mark("text", (await M.eval("document.body.innerText")).slice(0, 300));
await sleep(2000);
const meta = await M.eval(`document.querySelector('meta[name=viewport]').content`);
check("viewport locked", /user-scalable=no/.test(meta) && /maximum-scale=1/.test(meta), meta);
check("touch-action class on html", await M.eval(`document.documentElement.classList.contains('no-page-zoom') && getComputedStyle(document.body).touchAction`), await M.eval(`getComputedStyle(document.body).touchAction`));
await pinch();
const s1 = await scale();
check("pinch does not zoom lesson", s1 <= 1.01, s1);
await dbltap();
const s2 = await scale();
check("double tap does not zoom lesson", s2 <= 1.01, s2);
const endText = await M.eval("document.body.innerText");
check("still in lesson", /Тимур Учителев/.test(endText), endText.slice(0, 200));
await finish();
