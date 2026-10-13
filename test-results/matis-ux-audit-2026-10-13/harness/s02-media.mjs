// Микрофон/камера/демонстрация: быстрые повторные нажатия, остановка демонстрации системной кнопкой,
// учитель глушит ученика, быстрые старт/стоп демонстрации.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, waitFor, ui, finish, sleep, shot, ctlState, MIC, CAM, SHARE, press, flow, mark, labelOf, LID, teacherApi, text } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await teacherJoin(T); await resetLesson(T);
// ученику разрешаем камеру и демонстрацию
check("s1 joins", await guestEnter(S, "Ученик Медиа", { cam: false }));
await sleep(3000);

mark("1. Ученик 7 раз быстро жмёт микрофон");
for (let i = 0; i < 7; i++) { const l = await labelOf(S, [MIC.on, MIC.off]); await press(S, l); await sleep(120); }
await sleep(4000);
const uiMic = await ctlState(S, MIC);
const f = await flow(S);
check("mic: UI state matches what is sent", (uiMic === true) === (f.outAudioBytes > 1500), { uiMic, outAudioBytes: f.outAudioBytes });

mark("2. Учитель 7 раз быстро жмёт камеру");
for (let i = 0; i < 7; i++) { const l = await labelOf(T, [CAM.on, CAM.off]); await press(T, l); await sleep(120); }
await sleep(6000);
const uiCam = await ctlState(T, CAM);
const ft = await flow(T); const fs_ = await flow(S);
check("cam: teacher UI state matches what is sent", (uiCam === true) === (ft.outVideoBytes > 20000), { uiCam, outVideo: ft.outVideoBytes });
check("cam: student sees teacher video iff teacher camera on", (uiCam === true) === (fs_.remoteVideoPlaying > 0), { uiCam, remote: fs_.remoteVideoPlaying });
await shot(T, "cam-rapid"); await shot(S, "cam-rapid");

mark("3. Учитель глушит ученика");
if ((await ctlState(S, MIC)) !== true) { await press(S, MIC.off); await sleep(2500); }
const sid = await S.eval(`(async () => (await fetch("/api/v1/guest/session", {credentials:"include"}).then(r=>r.json())).guestId)()`);
check("mute api", (await teacherApi(T, "POST", `/lessons/${LID}/participants/${sid}/mute`)) === 204);
await sleep(2500);
const sUi = await ui(S);
check("student mic shows off after teacher mute", (await ctlState(S, MIC)) === false, await ctlState(S, MIC));
check("student told who muted", sUi.toasts.some((t) => /Учитель выключил/.test(t)), sUi.toasts);
const fm = await flow(S);
check("student actually not sending audio after mute", fm.outAudioBytes < 1500, fm.outAudioBytes);

mark("4. Учитель: демонстрация старт → системная «Закрыть доступ»");
await press(T, SHARE.off);
const shareOn = await waitFor(async () => (await labelOf(T, [SHARE.on])) === SHARE.on, 20000);
check("share started", shareOn.ok, { ms: shareOn.ms, ui: await ui(T) });
await sleep(4000);
const sv = await S.eval(`!!document.body.innerText.match(/показывает экран/)`);
check("student sees 'показывает экран'", sv);
const n = await T.eval("window.__stopDisplay ? window.__stopDisplay() : -1");
await sleep(4000);
check("after system stop: teacher button back to 'Демонстрация'", (await labelOf(T, [SHARE.on, SHARE.off])) === SHARE.off, { stopped: n });
check("after system stop: student no longer sees share", !(await S.eval(`!!document.body.innerText.match(/показывает экран/)`)));
const claim = await S.eval(`(async () => { const r = await fetch("/api/v1/lessons/${LID}/screen-share/claim", { method: "POST", credentials: "include" }); return r.status + " " + await r.text(); })()`);
check("lock released after system stop (student can claim)", /"granted":true/.test(claim), claim);
await S.eval(`fetch("/api/v1/lessons/${LID}/screen-share/release", { method: "POST", credentials: "include" })`);

mark("5. Учитель: 5 раз быстро старт/стоп демонстрации");
for (let i = 0; i < 5; i++) { const l = await labelOf(T, [SHARE.on, SHARE.off]); if (l) await press(T, l); await sleep(300); }
await sleep(8000);
const lbl = await labelOf(T, [SHARE.on, SHARE.off]);
const studentSees = await S.eval(`!!document.body.innerText.match(/показывает экран/)`);
check("rapid share toggle: teacher UI and student view agree", (lbl === SHARE.on) === studentSees, { lbl, studentSees });
const shares = await T.eval(`window.__display.filter(t => t.readyState === 'live' && t.kind === 'video').length`);
check("rapid share toggle: at most one live capture", shares <= 1, { liveCaptures: shares });
await shot(T, "share-rapid"); await shot(S, "share-rapid");
if (lbl === SHARE.on) await press(T, SHARE.on);
await finish();
