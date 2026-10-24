// 2026-10-24: учитель один в уроке на разных размерах окна (скриншоты владельца:
// плитка тянется, в низком окне — полоса). Снимаем геометрию и кадры.
import fs from "node:fs";
import { resetLesson, openBrowsers, P, teacherJoin, check, finish, sleep, mark, shot } from "./lib.mjs";
await openBrowsers(["teacher"]);
const T = P.teacher;
check("teacher joins", await teacherJoin(T, { cam: true, mic: false }));
await resetLesson(T);
const GEO = `(() => { const cell = document.querySelector('.grid-cell') || document.querySelector('[class*="group/tile"]'); const tile = document.querySelector('[class*="group/tile"]'); const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }; const host = document.querySelector('.grid-cell')?.parentElement; const card = document.querySelector('.solo-side'); return { tile: r(tile), card: r(card), cardAspect: card ? +(card.getBoundingClientRect().width / card.getBoundingClientRect().height).toFixed(2) : null, cell: r(cell), host: r(host), fit: (() => { const v = document.querySelector('[class*="group/tile"] video'); return v ? [getComputedStyle(v).objectFit, v.videoWidth, v.videoHeight] : null; })(), aspect: tile ? +(tile.getBoundingClientRect().width / tile.getBoundingClientRect().height).toFixed(2) : null, hasGridCell: !!document.querySelector('.grid-cell') }; })()`;
for (const [w, h] of (process.env.SIZES || "800x1000,1000x700,1000x420,1000x260,1440x900,500x800").split(",").map((s) => s.split("x").map(Number))) {
  await T.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(1200);
  const g = await T.eval(GEO);
  mark(`${w}x${h}`, g);
  await shot(T, `cam-${w}x${h}`);
}
await finish();
