import { Bot, sleep, log, OUT } from "./lib.mjs";
const cfg = { lessonId: process.env.LID, joinPath: process.env.JOIN_PATH };
const bots = [1, 2].map((i) => new Bot(900 + i, cfg));
for (const b of bots) { await b.enter(); await b.join(); b.openWs(); b.startMedia({ video: true, audio: b.i === 901 ? "/media/s1.ogg" : null }); }
await sleep(12000);
for (const b of bots) console.log(b.i, b.identity, b.room, b.wsState, b.msgs.map((m) => m.type).join(","), "lk alive:", !!b.lk, b.timeline);
for (const b of bots) await b.leave();
await sleep(1000);
process.exit(0);
