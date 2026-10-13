// Выключил микрофон в первые секунды после входа — не включится ли он сам (страховка MediaRecovery через 3 и 9 с)?
import { resetLesson, openBrowsers, P, teacherJoin, check, waitFor, finish, sleep, mark, ORIGIN, JOIN, byText, inRoom, ctlState, MIC, press, flow, log } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await teacherJoin(T); await resetLesson(T);
await S.goto(`${ORIGIN}${JOIN}`);
await waitFor(() => S.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`), 20000);
await S.click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await S.type("Ученик Тихий");
await S.click(`document.querySelector('[role=checkbox]')`); await S.click("document.querySelector('button[type=submit]')");
await waitFor(() => S.eval(`!!${byText("button", "Присоединиться")}`), 20000); await sleep(1200);
await S.click(byText("button", "Присоединиться"));
await waitFor(async () => (await ctlState(S, MIC)) === true, 15000);
mark("микрофон включился при входе — выключаем через 1 с");
await sleep(1000);
await press(S, MIC.on);
const states = [];
for (let i = 0; i < 14; i++) { await sleep(1000); states.push(await ctlState(S, MIC)); }
log({ kind: "info", text: "mic state per second after mute", extra: states });
const f = await flow(S);
check("mic stays off after early mute (no auto re-enable)", states.every((s) => s === false), states);
check("no audio actually sent", f.outAudioBytes < 1500, f.outAudioBytes);
await finish();
