// 2026-10-19: RNNoise и на двухъядерных устройствах (MacBook Юли, score 35,8).
// Ученик s1 видит 2 ядра (CDP), CPU s1 задаёт run-noise-dualcore.sh. Проверяем:
// «Авто» → RNNoise, учитель слышит ученика, через 3 мин урока с камерой RNNoise
// не откатился (или — при CPU как у Елены — откатился молча и звук идёт).
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, waitFor, flow, hears, mark } from "./lib.mjs";

const EXPECT_FALLBACK = process.env.EXPECT_FALLBACK === "1";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await S.send("Emulation.setHardwareConcurrencyOverride", { hardwareConcurrency: 2 });
check("teacher joins", await teacherJoin(T));
await resetLesson(T);
check("s1 enters", await guestEnter(S, "Юля Тестова"));

const SENDER = `(() => {
  const s = window.__pcs.filter(pc => pc.connectionState !== 'closed').flatMap(pc => pc.getSenders()).find(x => x.track && x.track.kind === 'audio');
  if (!s) return null;
  return { processed: s.track.label === 'MediaStreamAudioDestinationNode', ns: s.track.getSettings().noiseSuppression ?? null, cores: navigator.hardwareConcurrency };
})()`;
const sender = () => S.eval(SENDER).catch((e) => ({ err: String(e) }));

const rn = await waitFor(async () => (await sender())?.processed === true, 20000);
check("dual-core auto → RNNoise track sent", rn.ok, await sender());
let f;
await waitFor(async () => hears(f = await flow(T, 3000)), 30000, 100);
check("teacher hears s1 with RNNoise", hears(f), f);

for (let m = 1; m <= 3; m++) {
  await sleep(60000);
  mark(`minute ${m}`, { sender: await sender(), flow: await flow(T, 3000) });
}
const end = await sender();
if (EXPECT_FALLBACK) check("overloaded device fell back to built-in NS", end?.processed === false && end?.ns === true, end);
else check("RNNoise still on after 3 min", end?.processed === true, end);
check("teacher still hears s1", hears(f = await flow(T, 3000)), f);
await finish();
