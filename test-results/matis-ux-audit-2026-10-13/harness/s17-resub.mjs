// Эксперимент: после скачка задержки переподписаться на звук собеседника — сбрасывается ли задержка и какой пропуск.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, mark, ctl, clearNet, log } from "./lib.mjs";
await openBrowsers(["teacher", "s1"]);
const T = P.teacher, S = P.s1;
await teacherJoin(T); await resetLesson(T);
check("s1 joins", await guestEnter(S, "Ученик Resub"));
await sleep(6000);
// только для теста: найти Room в дереве React (контекст LiveKitRoom)
const FIND_ROOM = `(() => { if (window.__room) return true; const root = document.getElementById('root'); const key = Object.keys(root).find(k => k.startsWith('__reactContainer')); const stack = [root[key]]; let n = 0; while (stack.length && n++ < 200000) { const f = stack.pop(); if (!f) continue; const v = f.memoizedProps && f.memoizedProps.value; if (v && typeof v === 'object' && v.remoteParticipants && v.localParticipant) { window.__room = v; return true; } if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling); } return false; })()`;
check("found room (test hook)", await S.eval(FIND_ROOM));
const jb = (p) => p.eval(`(async () => { const s = await window.__collect(); const a = s.filter(x => x.conn !== 'closed').flatMap(x => x.inbound || []).filter(x => x.kind === 'audio'); return { d: a.reduce((s, x) => s + (x.jitterBufferDelay || 0), 0), n: a.reduce((s, x) => s + (x.jitterBufferEmittedCount || 0), 0), b: a.reduce((s, x) => s + (x.bytesReceived || 0), 0) }; })()`, 5000).catch(() => null);
async function watch(p, seconds) { let prev = await jb(p); const rows = []; for (let i = 0; i < seconds; i++) { await sleep(1000); const cur = await jb(p); rows.push({ ms: cur.n > prev.n ? Math.round((1000 * (cur.d - prev.d)) / (cur.n - prev.n)) : null, kb: Math.round((cur.b - prev.b) / 1024) }); prev = cur; } return rows; }
mark("скачок 1500 мс на 8 с → переподписка на звук учителя");
await ctl({ cmd: "custom", who: "s1", down: 10000, up: 5000, lat: 1500, jit: 500, loss: 0 });
await sleep(8000);
await clearNet("s1");
await sleep(1500);
const before = await watch(S, 2);
const t0 = Date.now();
const r = await S.eval(`(async () => { const out = []; for (const p of window.__room.remoteParticipants.values()) for (const pub of p.trackPublications.values()) if (pub.kind === 'audio' && pub.isSubscribed) { pub.setSubscribed(false); out.push(pub.trackSid); } await new Promise(r => setTimeout(r, 150)); for (const p of window.__room.remoteParticipants.values()) for (const pub of p.trackPublications.values()) if (pub.kind === 'audio') pub.setSubscribed(true); return out; })()`);
log({ kind: "info", text: "resubscribed", extra: r });
const after = await watch(S, 10);
log({ kind: "info", text: "delay before / after resubscribe", extra: { before, after } });
check("resubscribe resets playout delay under 250 ms within 3 s", after.slice(0, 3).some((x) => x.ms !== null && x.ms < 250), after.slice(0, 4));
await finish();
