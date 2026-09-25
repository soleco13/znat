import { useEffect, useRef, useState } from "react";

import { Words } from "@/components/Ink";
import { useMedia } from "@/hooks/useMedia";
import { DESKTOP_H, DESKTOP_W, FitBox, PHONE_H, PHONE_W, PhoneWindow, RoomWindow, type DrawerTab, type Scene } from "@/lesson/RoomWindow";

type Step = {
  scene: Scene;
  drawer: DrawerTab;
  title: string;
  text: string;
  points: string[];
};

const STEPS: Step[] = [
  {
    scene: "people",
    drawer: null,
    title: "Класс на связи",
    text: "Плитки участников, кто говорит — подсвечен, поднятая рука видна сразу. Слабую связь вы заметите раньше, чем ученик пожалуется.",
    points: ["До 30 учеников", "Режимы «лекция» и «обсуждение»", "Приоритет камере учителя"],
  },
  {
    scene: "board",
    drawer: null,
    title: "Доска, на которой пишут вместе",
    text: "Учитель объясняет, ученик у доски решает, класс видит оба курсора. Права на рисование — по одному клику.",
    points: ["До 3 листов + слайды", "Курсоры и «следовать за учителем»", "Undo/redo не мешает соседу"],
  },
  {
    scene: "task",
    drawer: null,
    title: "Задание, которое класс делает вживую",
    text: "Выдали материал — у каждого своя копия. Красный карандаш учителя появляется у ученика сам, пока тот отвечает.",
    points: ["Индивидуальная копия", "Автосохранение каждые 5 секунд", "Пометки учителя поверх работы"],
  },
  {
    scene: "progress",
    drawer: null,
    title: "Учитель видит, кто застрял",
    text: "Прогресс класса обновляется на глазах. Нажмите на ученика — откроется его работа с текущими ответами.",
    points: ["Ответили · в работе · застряли", "Ключи ответов не уходят на клиент", "Разбор и очередь проверки"],
  },
  {
    scene: "people",
    drawer: "chat",
    title: "Вопросы — в чат, а не в эфир",
    text: "Ученик пишет, не перебивая объяснение. Учитель отвечает, когда удобно, — весь класс видит ответ.",
    points: ["Чат класса", "Список участников с поиском", "«Заглушить всех» одной кнопкой"],
  },
];

/**
 * Настоящее окно урока закреплено на экране, страница листается обычным
 * скроллом — сцена внутри окна меняется по прогрессу секции (без scroll-jacking).
 */
export function LessonFlow() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const desktop = useMedia("(min-width: 768px)", true);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      const p = total > 0 ? Math.min(0.999, Math.max(0, -r.top / total)) : 0;
      const raw = p * STEPS.length;
      barsRef.current?.style.setProperty("--f", String(raw - Math.floor(raw)));
      setIdx(Math.floor(raw));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(calc);
    };
    calc();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const step = STEPS[idx]!;

  return (
    <section id="lesson" className="relative">
      <div ref={wrapRef} style={{ height: `${STEPS.length * 85 + 15}vh` }}>
        <div className="sticky top-0 flex h-svh flex-col justify-center overflow-hidden bg-background pt-14">
          <div className="container-l">
            <div className="overflow-hidden rounded-[18px] border border-border bg-card shadow-xl">
              {desktop ? (
                <FitBox width={DESKTOP_W} height={DESKTOP_H} reserveH={300}>
                  <RoomWindow scene={step.scene} drawer={step.drawer} />
                </FitBox>
              ) : (
                <FitBox width={PHONE_W} height={PHONE_H} reserveH={330}>
                  <PhoneWindow scene={step.scene === "progress" ? "task" : step.scene} />
                </FitBox>
              )}
            </div>

            {/* подпись шага — как субтитры под окном */}
            <div className="mt-5 grid min-h-[104px] items-start gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-10">
              <div key={idx} className="fade-in">
                <Words as="h2" className="text-[22px] font-black leading-tight tracking-tightest sm:text-[30px]" step={30}>
                  {step.title}
                </Words>
              </div>
              <div key={`t${idx}`} className="fade-in" style={{ animationDelay: "120ms" }}>
                <p className="max-w-xl text-[14px] leading-relaxed text-muted-foreground md:text-[15px]">{step.text}</p>
                <ul className="mt-3 hidden md:flex flex-wrap gap-x-5 gap-y-1 text-[13.5px] font-semibold text-foreground">
                  {step.points.map((p) => (
                    <li key={p} className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-primary" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div ref={barsRef} className="mt-3 flex items-center gap-2" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={idx + 1} aria-label="Шаг урока">
              {STEPS.map((st, i) => (
                <span key={i} className="relative h-1 w-10 overflow-hidden rounded-full bg-border sm:w-14" title={st.title}>
                  <span
                    className="absolute inset-0 origin-left rounded-full bg-primary"
                    style={{ transform: i < idx ? "scaleX(1)" : i === idx ? "scaleX(var(--f, 0))" : "scaleX(0)", transition: i === idx ? "none" : "transform 0.4s var(--ease)" }}
                  />
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
