import { useState } from "react";
import {
  ClipboardList,
  GraduationCap,
  PenLine,
  Presentation,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";

const TABS = [
  { id: "board", label: "Доска", icon: PenLine },
  { id: "slides", label: "Слайды", icon: Presentation },
  { id: "task", label: "Задание", icon: ClipboardList },
  { id: "review", label: "Разбор", icon: GraduationCap },
] as const;

type TabId = (typeof TABS)[number]["id"];

const COPY: Record<TabId, { title: string; text: string }> = {
  board: {
    title: "Доска, на которой пишут вместе",
    text: "Учитель объясняет, ученик у доски решает, класс видит оба курсора. Права на рисование — по одному клику.",
  },
  slides: {
    title: "Слайды прямо в холсте",
    text: "Презентация становится страницами доски. Пишите поверх, листайте для всех сразу, ищите слайд по слову.",
  },
  task: {
    title: "Задание, которое класс делает вживую",
    text: "Выдали материал — у каждого своя копия. На панели прогресса видно, кто ответил, кто застрял.",
  },
  review: {
    title: "Разбор без «а кто написал вот это»",
    text: "Показали правильные ответы всем, вынесли удачное решение на доску, дали учителю пометить карандашом работу ученика.",
  },
};

export function CanvasShowcase() {
  const [tab, setTab] = useState<TabId>("board");

  return (
    <section
      id="canvas"
      className="relative scroll-mt-24 overflow-hidden bg-gradient-to-b from-white to-background py-20 sm:py-28"
    >
      <div className="pointer-events-none absolute inset-0 bg-dots [mask-image:radial-gradient(ellipse_70%_50%_at_50%_50%,#000,transparent)] opacity-60" />

      <div className="container-l relative">
        <SectionHeading
          eyebrow="Единый холст"
          title="Всё, на что смотрит урок, — в одном месте"
          subtitle="Учитель переключает вид для всего класса. Плитки камер уезжают в ленту, доска или задание занимают экран."
        />

        <Reveal className="mx-auto mt-12 flex max-w-md flex-wrap justify-center gap-1.5 rounded-pill border border-border bg-card p-1.5 shadow-sm">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-[13.5px] font-semibold transition-all duration-200 ease-ds",
                tab === t.id
                  ? "bg-primary text-primary-foreground shadow-[0_6px_16px_-6px_rgba(29,78,216,0.6)]"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <t.icon className="size-4" />
              {t.label}
            </button>
          ))}
        </Reveal>

        <Reveal delay={80} className="mx-auto mt-10 grid max-w-5xl items-center gap-8 lg:grid-cols-[0.85fr_1.15fr]">
          <div key={tab} className="animate-fade-in">
            <h3 className="text-[22px] font-heavy tracking-head text-foreground sm:text-[26px]">
              {COPY[tab].title}
            </h3>
            <p className="mt-3 text-[15.5px] leading-relaxed text-muted-foreground">
              {COPY[tab].text}
            </p>
            <ul className="mt-5 space-y-2 text-[14px] text-foreground">
              {BULLETS[tab].map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  {b}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative rounded-2xl border border-border bg-card p-2.5 shadow-xl">
            <div key={tab} className="animate-fade-in overflow-hidden rounded-xl border border-border bg-white">
              <StagePanel tab={tab} />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const BULLETS: Record<TabId, string[]> = {
  board: ["До 3 листов + импортированные слайды", "Курсоры и «следовать за учителем»", "Undo/redo не мешает соседу"],
  slides: [".pptx и .pdf → чёткие изображения", "Текстовый слой для поиска", "Листается синхронно у всех"],
  task: ["Индивидуальная копия — сосед не виден", "Автосохранение каждые 5 секунд", "Таймер и дедлайн"],
  review: ["Ключи ответов не уходят на клиент до сдачи", "Гистограмма ответов по классу", "Пометки учителя поверх работы"],
};

function StagePanel({ tab }: { tab: TabId }) {
  if (tab === "board") {
    return (
      <svg viewBox="0 0 420 240" className="w-full" aria-hidden>
        <defs>
          <pattern id="cs-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="rgba(16,24,40,0.05)" />
          </pattern>
        </defs>
        <rect width="420" height="240" fill="url(#cs-grid)" />

        {/* ромб */}
        <path d="M130 40 L212 118 L130 196 L48 118 Z" fill="none" stroke="#1d4ed8" strokeWidth="3" strokeLinejoin="round" />
        {/* диагонали */}
        <path d="M130 40 V 196" stroke="#98a2b3" strokeWidth="1.5" strokeDasharray="4 4" />
        <path d="M48 118 H 212" stroke="#98a2b3" strokeWidth="1.5" strokeDasharray="4 4" />
        {/* подписи диагоналей «от руки» + маркер учителя */}
        <rect x="122" y="60" width="20" height="72" rx="4" fill="#f5d90a" opacity="0.35" />
        <text x="150" y="78" fontSize="13" fill="#dc2626" fontWeight="600">d₁</text>
        <text x="176" y="112" fontSize="13" fill="#dc2626" fontWeight="600">d₂</text>

        {/* формула */}
        <text x="250" y="112" fontSize="16" fontWeight="700" fill="#101828">S = ½·d₁·d₂</text>
        <path d="M248 122 q 40 8 92 0" fill="none" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round" />

        {/* курсор учителя */}
        <g transform="translate(206 122)">
          <path d="M0 0 L0 15 L4 11 L7 17 L10 16 L7 10 L12 10 Z" fill="#1d4ed8" />
          <rect x="13" y="10" width="60" height="14" rx="7" fill="#1d4ed8" />
          <text x="19" y="20.5" fontSize="8.5" fill="#fff" fontWeight="600">Учитель</text>
        </g>
      </svg>
    );
  }
  if (tab === "slides") {
    return (
      <div className="relative aspect-[420/240] bg-[#0b1220] p-6">
        <div className="flex h-full flex-col rounded-lg bg-white p-5 shadow-lg">
          <span className="text-[13px] font-bold text-primary">Теорема Виета</span>
          <span className="mt-1 text-[11px] text-text-3">Слайд 7 из 14</span>
          <div className="mt-3 flex flex-1 items-center justify-center rounded-md bg-primary-light/50">
            <span className="font-mono text-[15px] font-bold text-foreground">x₁ + x₂ = −b/a</span>
          </div>
        </div>
        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={cn("h-1 rounded-full", i === 2 ? "w-5 bg-white" : "w-2 bg-white/40")} />
          ))}
        </div>
        {/* маркер поверх слайда */}
        <div className="absolute left-16 top-16 h-6 w-40 rounded-sm bg-[#f5d90a] opacity-40" />
      </div>
    );
  }
  if (tab === "task") {
    return (
      <div className="space-y-3 p-5 text-[12px]">
        <div className="flex items-center justify-between">
          <span className="font-bold text-foreground">Проверочная: дроби</span>
          <span className="rounded-pill bg-primary-light px-2 py-0.5 text-[10px] font-semibold text-primary">
            5 вопросов
          </span>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="font-medium text-foreground">1. Сократите: 12/18</p>
          <div className="mt-2 flex gap-1.5">
            {["1/2", "2/3", "3/4"].map((o, i) => (
              <span
                key={o}
                className={cn(
                  "rounded-md border px-2.5 py-1",
                  i === 1 ? "border-primary bg-primary-light font-semibold text-primary" : "border-border text-muted-foreground",
                )}
              >
                {o}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-3">Прогресс класса</span>
          <div className="mt-2 flex flex-wrap gap-1">
            {[1, 1, 1, 2, 0, 0, 1, 1, 0, 2, 1, 0, 1, 1, 0].map((s, i) => (
              <span
                key={i}
                className={cn(
                  "size-3.5 rounded-[3px]",
                  s === 1 ? "bg-success" : s === 2 ? "bg-warning" : "bg-surface-3",
                )}
              />
            ))}
          </div>
          <div className="mt-2 flex gap-3 text-[10px] text-muted-foreground">
            <span>7 ответили</span>
            <span>2 в работе</span>
            <span>3 не начали</span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3 p-5 text-[12px]">
      <span className="font-bold text-foreground">Разбор · вопрос 3</span>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border p-2.5">
          <span className="text-[9px] font-semibold uppercase text-text-3">Ответ ученика</span>
          <p className="font-semibold text-danger">x = 4</p>
        </div>
        <div className="rounded-lg border border-success/30 bg-success-light p-2.5">
          <span className="text-[9px] font-semibold uppercase text-text-3">Верный ответ</span>
          <p className="font-semibold text-success">x = −2; x = 4</p>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-3">
          Ответы класса
        </span>
        <div className="mt-2 flex items-end gap-1.5" style={{ height: 56 }}>
          {[
            { h: 20, label: "A" },
            { h: 52, label: "B", ok: true },
            { h: 14, label: "C" },
            { h: 30, label: "D" },
          ].map((b) => (
            <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
              <span
                className={cn("w-full rounded-t-sm", b.ok ? "bg-success" : "bg-primary-muted")}
                style={{ height: b.h }}
              />
              <span className="text-[9px] text-text-3">{b.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="relative rounded-lg border border-border p-3">
        <p className="text-foreground">Решите x² − 2x − 8 = 0</p>
        <svg className="pointer-events-none absolute inset-0" aria-hidden>
          <path d="M20 34 q 60 -14 130 0" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
