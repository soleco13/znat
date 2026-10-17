// 2026-10-17: имя ученика запоминается для следующих входов (кука guest_name, любой урок).
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, passDeviceCheck, check, finish, sleep, waitFor, ORIGIN, JOIN } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
check("teacher joins", await teacherJoin(T));
await resetLesson(T);
check("s1 enters as «Ника Тестова»", await guestEnter(S, "Ника Тестова"));
await sleep(2000);
await S.goto(`${ORIGIN}${JOIN}`);
const ok = await waitFor(() => S.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`), 30000);
check("join form shown again", ok.ok);
check("name prefilled", (await S.eval(`document.querySelector('input[placeholder="Имя и фамилия"]').value`)) === "Ника Тестова", await S.eval(`document.querySelector('input[placeholder="Имя и фамилия"]').value`));
check("consent checkbox absent", !(await S.eval(`!!document.querySelector('[role=checkbox]')`)));
await S.click("document.querySelector('button[type=submit]')");
check("s1 passes device check and enters", await passDeviceCheck(S));
await sleep(3000);
const names = await T.eval("document.body.innerText");
check("teacher sees same name, no rename", /Ника Тестова/.test(names) && !/Ученик \d/.test(names));
await finish();
