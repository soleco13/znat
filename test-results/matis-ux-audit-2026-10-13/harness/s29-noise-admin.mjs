// 2026-10-17: режим шумоподавления школы на странице «Параметры».
import { openBrowsers, P, check, finish, sleep, waitFor, login, ORIGIN, sql, mark } from "./lib.mjs";
await openBrowsers(["teacher"]);
const A = P.teacher;
await login(A, "admin@school.dev");
await A.goto(`${ORIGIN}/admin/settings`);
const row = `[...document.querySelectorAll('button[role=combobox]')].find(b => b.closest('div').parentElement.innerText.includes('Шумоподавление микрофона'))`;
check("noise select present", (await waitFor(() => A.eval(`!!${row}`), 20000)).ok);
mark("current", await A.eval(`${row}.innerText`));
async function pick(text) {
  await A.click(row);
  await waitFor(() => A.eval(`document.querySelectorAll('[role=option]').length > 0`), 8000);
  await A.click(`[...document.querySelectorAll('[role=option]')].find(o => o.innerText.startsWith(${JSON.stringify(text)}))`);
  await sleep(1500);
}
await pick("Выключено");
let r = await sql("select settings->>'noiseSuppressionMode' m, settings->>'noiseSuppressionEnabled' e from schools limit 1");
check("saved off", r[0] === "off|false", r);
await pick("Авто");
r = await sql("select settings->>'noiseSuppressionMode' m, settings->>'noiseSuppressionEnabled' e from schools limit 1");
check("saved auto", r[0] === "auto|true", r);
await finish();
