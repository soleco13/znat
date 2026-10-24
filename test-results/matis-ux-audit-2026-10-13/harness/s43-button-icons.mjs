// 2026-10-24: какие иконки стоят на кнопках урока (компьютер, телефон, меню «Ещё»).
import fs from "node:fs";
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, byLabel } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
check("teacher joins", await teacherJoin(T, { cam: true, mic: true }));
await resetLesson(T);
check("s1 joins", await guestEnter(S, "Юля Тестова", { cam: true, mic: true }));
const LIST = `[...document.querySelectorAll('button, [role=menuitem], [role=menuitemcheckbox]')].filter(b => b.getBoundingClientRect().width > 0).map(b => ({ label: b.getAttribute('aria-label') || b.innerText.trim().slice(0, 30), icons: [...b.querySelectorAll('svg')].map(s => [...s.classList].find(c => c.startsWith('lucide-') && c !== 'lucide') || s.getAttribute('class')) }))`;
const out = {};
for (const [who, p] of [["teacher", T], ["student", S]]) {
  for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
    await p.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
    await sleep(1500);
    out[`${who}-${w}`] = await p.eval(LIST);
    for (const more of ["Ещё", "Другие кнопки урока"]) {
      if (await p.eval(`!!${byLabel(more)}`)) { await p.click(byLabel(more)); await sleep(700); out[`${who}-${w}-${more}`] = await p.eval(LIST); await p.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(400); }
    }
  }
}
fs.writeFileSync(`${process.env.OUT}/buttons.json`, JSON.stringify(out, null, 1));
await finish();
