// 2026-10-17: единые уведомления урока — все справа сверху, одним видом.
// Копия ссылки, рука, чат, «дал слово», демонстрация, комната ожидания, обрыв связи.
import { resetLesson, openBrowsers, P, teacherJoin, guestEnter, check, finish, sleep, waitFor, ORIGIN, JOIN, LID, teacherApi, mark, byText, byLabel, sendChat, press, shot, cut } from "./lib.mjs";
await openBrowsers(["teacher", "s1", "s2"]);
const T = P.teacher, S = P.s1, K = P.s2;

/** Видимые уведомления: текст, кнопки, место на экране. */
const notices = (p) => p.eval(`(() => [...document.querySelectorAll('[data-sonner-toast][data-visible=true]')].map((li) => {
  const card = li.querySelector('[role=status]') || li; const r = card.getBoundingClientRect();
  return { text: card.innerText.replace(/\\s+/g, ' ').trim(), buttons: [...card.querySelectorAll('button')].map((b) => b.textContent.trim() || b.getAttribute('aria-label')),
    x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height), right: Math.round(innerWidth - r.right), w: Math.round(r.width), bg: getComputedStyle(card).backgroundColor };
}))()`).catch(() => []);
const has = async (p, s) => (await notices(p)).find((n) => n.text.includes(s));
const waitNotice = (p, s, ms = 15000) => waitFor(() => has(p, s), ms);
const clickNotice = (p, s, label) => p.click(`(() => { const li = [...document.querySelectorAll('[data-sonner-toast]')].find((l) => l.innerText.includes(${JSON.stringify(s)})); return li && [...li.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}); })()`);
const placed = (n, top = 60) => n && n.right >= 8 && n.right <= 20 && n.y >= top && n.h === 64 && !n.buttons.includes("Закрыть уведомление") && n.bg === "rgb(255, 255, 255)";
const single = async (p) => (await notices(p)).length <= 1;
const report = async (p, name) => { const list = await notices(p); console.log(name, JSON.stringify(list)); await shot(p, name); return list; };

check("teacher joins", await teacherJoin(T));
await resetLesson(T);
check("student joins", await guestEnter(S, "Ученик Проверка"));
await sleep(4000);

mark("ссылка");
await press(T, "Пригласить").catch(() => {});
if (!(await has(T, "сылк"))) await T.click(byText("button", "Пригласить"));
const link = await waitNotice(T, "сылк", 5000);
check("copy-link notice top-right", link.ok && placed(link.v), link.v);

mark("забрать слово");
await T.click(`[...document.querySelectorAll('button[aria-label="Действия — Ученик Проверка"]')].find((b) => b.getBoundingClientRect().width > 0)`);
await sleep(600);
await T.click(`[...document.querySelectorAll('[role=menuitem]')].find((m) => m.textContent.includes("Забрать слово"))`);
const muted = await waitNotice(S, "выключил ваш микрофон", 10000);
check("student sees «Учитель выключил ваш микрофон»", muted.ok && placed(muted.v), muted.v);
await report(S, "s-muted");
mark("рука");
await press(S, "Поднять руку");
const hand = await waitNotice(T, "Поднимает руку");
check("hand notice has Дать слово", hand.ok && hand.v.buttons.includes("Дать слово"), hand.v);
check("hand notice top-right under header", placed(hand.v, 64), hand.v);
mark("чат");
await sendChat(S, "Можно повторить про дискриминант?");
const chat = await waitNotice(T, "дискриминант");
check("chat notice replaces hand, with Ответить", chat.ok && chat.v.buttons.includes("Ответить") && placed(chat.v, 64) && (await single(T)), chat.v);
check("no chat bubble on tiles", !(await T.eval(`!!document.querySelector('[aria-label^="Новое сообщение"]')`)));
await report(T, "t-stack");

mark("дать слово");
await sleep(8500);
await press(S, "Опустить руку"); await sleep(800); await press(S, "Поднять руку");
const hand2 = await waitNotice(T, "Поднимает руку");
await clickNotice(T, "Поднимает руку", "Дать слово");
const gone = await waitFor(async () => !(await has(T, "Поднимает руку")), 8000);
check("hand notice closes after Дать слово", gone.ok);
const word = await waitNotice(S, "дал вам слово", 10000);
check("student sees «дал вам слово»", word.ok && placed(word.v), word.v);
await report(S, "s-word");

mark("демонстрация");
await press(T, "Демонстрация");
const self = await waitNotice(T, "Вы показываете экран", 20000);
check("sharer sees «Вы показываете экран» + Остановить", self.ok && self.v.buttons.includes("Остановить"), self.v);
check("only one notice visible at a time (teacher)", await single(T), await notices(T));
const other = await waitNotice(S, "показывает экран", 15000);
check("student sees «… показывает экран»", other.ok && placed(other.v), other.v);
check("no status bar above share", !(await S.eval(`[...document.querySelectorAll('main *, div')].some((e) => !e.closest('[data-sonner-toast]') && e.children.length === 0 && /показывает экран$/.test(e.textContent.trim()))`)));
await report(S, "s-share"); await report(T, "t-share");
await clickNotice(T, "Вы показываете экран", "Остановить");
check("share notice gone after Остановить", (await waitFor(async () => !(await has(T, "Вы показываете экран")), 10000)).ok);

mark("комната ожидания");
await teacherApi(T, "PATCH", `/lessons/${LID}/entry`, { locked: true });
await sleep(1000);
await K.goto(`${ORIGIN}${JOIN}`);
await waitFor(() => K.eval(`!!document.querySelector('input[placeholder="Имя и фамилия"]')`), 30000);
await K.click(`document.querySelector('input[placeholder="Имя и фамилия"]')`); await K.type("Стучащий Ученик");
await K.click("document.querySelector('button[type=submit]')");
await waitFor(() => K.eval(`!!${byText("button", "Присоединиться")}`), 20000); await sleep(1200);
await K.click(byText("button", "Присоединиться"));
const knock = await waitNotice(T, "Просит войти", 20000);
check("knock notice with Впустить/Отклонить", knock.ok && knock.v.buttons.includes("Впустить") && knock.v.buttons.includes("Отклонить") && placed(knock.v, 64), knock.v);
await report(T, "t-knock");
await clickNotice(T, "Просит войти", "Впустить");
check("knock notice gone after Впустить", (await waitFor(async () => !(await has(T, "Просит войти")), 10000)).ok);
await teacherApi(T, "PATCH", `/lessons/${LID}/entry`, { locked: false });

mark("обрыв связи ученика");
await cut("s1", true);
const lost = await waitNotice(S, "Связь прервалась", 120000);
await sleep(1000);
const lost2 = await has(S, "Связь прервалась");
check("connection-lost notice (not overlay) top-right", lost.ok && placed(lost2) && lost2.buttons.includes("Выйти"), lost2);
check("no full-screen overlay", !(await S.eval(`!!document.querySelector('[role=alertdialog]')`)));
await report(S, "s-lost");
await cut("s1", false);
check("connection-lost notice gone after restore", (await waitFor(async () => !(await has(S, "Связь прервалась")), 60000)).ok);

await finish();
