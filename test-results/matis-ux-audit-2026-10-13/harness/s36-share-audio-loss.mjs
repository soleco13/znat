// Звук демонстрации у зрителя на канале с потерями (урок 2026-10-19: «звук с демки заикается»).
// Учитель без микрофона показывает вкладку «DemoSound» со звуком (stand.sh up с
// CAPTURE_FLAG=--auto-select-tab-capture-source-by-title=DemoSound), так что единственный звук
// учителя у s1 — звук демонстрации. Входящий канал s1: LOSS % потерь (netctl). Замеры — sample.js.
import fs from "node:fs";
import { openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, press, SHARE, waitFor, labelOf, secondTab, ctl, clearNet } from "./lib.mjs";
const SAMPLE = fs.readFileSync("/w/sample.js", "utf8");
const SECS = Number(process.env.SECS || 150);
const LOSS = Number(process.env.LOSS || 15);
const wav = fs.readFileSync("/w/voice-teacher.wav").toString("base64");
const DEMO = "data:text/html;base64," + Buffer.from(
  `<!doctype html><title>DemoSound</title><audio id=a autoplay loop src="data:audio/wav;base64,${wav}"></audio>` +
  `<script>document.getElementById('a').play().catch(()=>{})</script>`).toString("base64");
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
check("teacher joins", await teacherJoin(T, { cam: true, mic: false }));
check("s1 joins", await guestEnter(S, "Зритель", { cam: true, mic: false }));
const D = await secondTab(T, "demo");
await D.goto(DEMO);
await sleep(1500);
check("demo plays", await D.eval("!document.getElementById('a').paused"));
await T.browser.call("Target.activateTarget", { targetId: T.targetId });
await sleep(1000);
await press(T, SHARE.off);
check("share on", (await waitFor(async () => (await labelOf(T, [SHARE.on])) === SHARE.on, 30000)).ok);
await sleep(8000);
const hasAudio = await S.eval(`(async()=>{let n=0;for(const pc of window.__pcs||[]){if(pc.connectionState==='closed')continue;(await pc.getStats()).forEach(r=>{if(r.type==='inbound-rtp'&&r.kind==='audio'&&r.packetsReceived>50)n++})}return n})()`);
check("s1 receives share audio", hasAudio >= 1, hasAudio);
await ctl({ cmd: "custom", who: "s1", down: 5000, up: 2000, lat: 40, jit: 5, loss: LOSS });
mark(`канал s1: потери ${LOSS} %`);
const out = fs.createWriteStream(`${process.env.OUT}/samples.jsonl`);
const end = Date.now() + SECS * 1000;
while (Date.now() < end) {
  for (const [who, p] of [["a", T], ["b", S]]) {
    try { out.write(JSON.stringify({ who, ...JSON.parse(await p.eval(SAMPLE, 15000)) }) + "\n"); } catch {}
  }
  await sleep(2000);
}
out.end();
const red = await S.eval(`(async()=>{const o=[];for(const pc of window.__pcs||[]){if(pc.connectionState==='closed')continue;const st=await pc.getStats();st.forEach(r=>{if(r.type==='inbound-rtp'&&r.kind==='audio')o.push(st.get(r.codecId)?.mimeType)})}return o.join(',')})()`);
mark("кодек звука у s1: " + red);
await clearNet("s1");
await finish({ codec: red });
