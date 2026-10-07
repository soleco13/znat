// Живая проверка: комментарий учителя доходит до ученика (сразу и после F5).
import fs from "node:fs";
import { connectBrowser, sleep } from "../matis-tile-placeholder-2026-10-06/cdp.mjs";
const ORIGIN = "https://213.21.241.28", LID = "add87950-752e-43b0-85c3-7628bbc079d5", OUT = "/out";
const results = []; const ok = (n, p, d = "") => { results.push({ n, p: !!p, d }); console.log(p ? "PASS" : "FAIL", n, d); };
const login = await (await fetch(`${ORIGIN}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@school.dev", password: "password123" }) })).json();
const H = { authorization: `Bearer ${login.accessToken}` };
const api = async (path, method = "GET", body) => { const r = await fetch(`${ORIGIN}/api/v1${path}`, { method, headers: body ? { ...H, "content-type": "application/json" } : H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); return { s: r.status, j: t ? JSON.parse(t) : null }; };

const material = { id: "fb-check", schemaVersion: 1, title: "Проверка комментария учителя", subject: "Математика", grades: [5], tags: [], groups: [],
  settings: { shuffleBlocks: false, showFeedback: "after_submit", attemptsAllowed: 1, layout: "scroll" },
  blocks: [{ type: "question", id: "q-open", prompt: { html: "<p>Объясните, почему 2 + 2 = 4</p>" }, points: 2,
    interaction: { type: "open_answer", maxLength: 500, allowAttachments: false, rubric: [{ id: "c1", label: "Есть объяснение", points: 2 }] } }] };
const created = process.env.MID ? { s: 201, j: { materialId: process.env.MID } } : await api("/materials", "POST", material);
ok("material created", created.s === 201, JSON.stringify(created.j).slice(0, 120));
const mid = created.j?.materialId;
const pub = await api(`/materials/${mid}/publish`, "POST");
ok("material published", pub.s === 200, `${pub.s} ${JSON.stringify(pub.j).slice(0, 120)}`);
const act = await api(`/lessons/${LID}/activities`, "POST", { materialId: mid });
ok("activity started", act.s === 201, `${act.s}`);
const aid = act.j?.id;

const gb = await connectBrowser(process.env.CDP_G);
const tabs = await (await fetch(`http://${process.env.CDP_G}/json/list`)).json();
const tab = tabs.find((t) => t.type === "page" && t.url.includes("/lessons/"));
const { sessionId } = await gb.call("Target.attachToTarget", { targetId: tab.id, flatten: true });
const ev = async (expression) => { const r = await gb.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId); return r.result.value; };
const shot = async (f) => { const { data } = await gb.call("Page.captureScreenshot", { format: "png" }, sessionId); fs.writeFileSync(f, Buffer.from(data, "base64")); };
await gb.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false }, sessionId);
await sleep(4000);
ok("guest sees the task on stage", await ev(`document.body.innerText.includes('Объясните, почему 2 + 2 = 4')`));
const g = (path, method = "GET", body) => ev(`fetch('/api/v1${path}', { method: '${method}', credentials: 'include'${body ? `, headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))}` : ""} }).then(async r => ({ s: r.status, t: await r.text() }))`);
const save = await g(`/activities/${aid}/responses`, "POST", { questionId: "q-open", response: { type: "open_answer", text: "Потому что два и ещё два — это четыре предмета.", attachmentIds: [] } });
ok("guest saved answer", save.s === 200, `${save.s}`);
const sub = await g(`/activities/${aid}/submit`, "POST");
ok("guest submitted", sub.s === 200, `${sub.s} ${sub.t.slice(0, 120)}`);
const before = JSON.parse((await g(`/activities/${aid}/my`)).t);
ok("no teacher feedback before grading", Array.isArray(before.teacherFeedback) && before.teacherFeedback.length === 0);

const queue = await api("/grading/queue");
const item = queue.j?.items?.find((i) => i.activityId === aid);
ok("answer in grading queue", item, item?.responseId);
// Ученик перечитывает задание по сигналу — перезагрузим страницу, чтобы плеер видел сданную попытку.
await gb.call("Page.reload", {}, sessionId); await sleep(6000);
const COMMENT = "Хорошо, но назови это сложением.";
const graded = await api(`/grading/${item.responseId}`, "POST", { score: 1.5, rubricScores: { c1: true }, comment: COMMENT });
ok("teacher graded", graded.s === 200, `${graded.s}`);
const live = await (async () => { for (let i = 0; i < 20; i++) { if (await ev(`document.body.innerText.includes(${JSON.stringify(COMMENT)})`)) return true; await sleep(500); } return false; })();
ok("comment appears for student without reload (activity_graded)", live);
await shot(`${OUT}/guest-teacher-comment.png`);
await gb.call("Page.reload", {}, sessionId); await sleep(6000);
ok("comment persists after F5", await ev(`document.body.innerText.includes(${JSON.stringify(COMMENT)}) && document.body.innerText.includes('Проверено учителем')`));
fs.writeFileSync(`${OUT}/feedback-results.json`, JSON.stringify({ results, materialId: mid, activityId: aid }, null, 1));
process.exit(0);
