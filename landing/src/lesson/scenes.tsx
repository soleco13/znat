import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  Hand,
  ImagePlus,
  Lock,
  MessageSquare,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Search,
  Square,
  Circle as CircleIcon,
  Diamond,
  ArrowRight,
  Type,
  Undo2,
  X,
  MicOff,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CHAT, PEOPLE, PROGRESS_START, type ProgressRow } from "./data";
import { LBadge, LButton, RailMore, Tile, UserAvatar, useLive } from "./parts";

/* ───────────── Сетка плиток и колонка ───────────── */

export function VideoGrid({ cols = 4, max = 12 }: { cols?: number; max?: number }) {
  const list = PEOPLE.slice(0, max);
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2.5">
      <div
        className="grid min-h-0 flex-1 content-center justify-center"
        style={{ gap: 10, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {list.map((p, i) => (
          <div key={p.id} className="pop" style={{ ["--d" as string]: `${i * 70}ms` } as React.CSSProperties}>
            <Tile
              name={p.name}
              size="lg"
              className="aspect-video w-full"
              self={p.self}
              role={p.teacher ? "teacher" : undefined}
              video={p.video}
              speaking={p.speaking}
              hand={p.hand}
              micOff={p.micOff}
              weak={p.weak}
              speakAt={p.speaking ? 500 : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Колонка 190px рядом с доской/заданием (variant="rail"): 5 плиток + «ещё N». */
export function TileRail() {
  const shown = PEOPLE.slice(0, 5);
  return (
    <div className="flex w-[190px] shrink-0 flex-col gap-2 overflow-hidden">
      {shown.map((p, i) => (
        <div key={p.id} className="slide-in" style={{ ["--d" as string]: `${200 + i * 90}ms` } as React.CSSProperties}>
          <Tile
            name={p.name}
            size="sm"
            className="aspect-video w-full shrink-0"
            self={p.self}
            video={p.video}
            speaking={p.speaking}
            hand={p.hand}
            micOff={p.micOff}
          />
        </div>
      ))}
      <RailMore>ещё {PEOPLE.length - shown.length}</RailMore>
    </div>
  );
}

/** Лента 84×3:4 под главным блоком (телефон). */
export function TileStrip({ from = 1 }: { from?: number }) {
  const list = PEOPLE.slice(from, from + 3);
  return (
    <div className="flex shrink-0 gap-2 overflow-hidden">
      {list.map((p) => (
        <Tile key={p.id} name={p.name} size="xs" className="aspect-[3/4] w-[84px] shrink-0" video={p.video} hand={p.hand} />
      ))}
      <span className="flex aspect-[3/4] w-[84px] shrink-0 items-center justify-center rounded-xl bg-[#101828] text-base font-black text-white">
        +{PEOPLE.length - from - 3}
      </span>
    </div>
  );
}

/* ───────────── Доска (Board.tsx + Board.css) ───────────── */

const RAIL_ICONS = [Lock, Hand, MousePointer2, Square, Diamond, CircleIcon, ArrowRight, Minus, Pencil, Type, ImagePlus, Eraser];

const HAND = `"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;

export function BoardScene({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="canvas-board relative min-h-0 flex-1 overflow-hidden rounded-[16px] border border-[var(--c-border-solid)] bg-white shadow-sm"
      >
        {/* холст */}
        <svg viewBox="0 0 820 520" preserveAspectRatio={compact ? "xMidYMid meet" : "xMidYMid slice"} className="absolute inset-0 size-full" aria-hidden>
          <path
            className="draw"
            style={{ ["--len" as string]: 960, ["--d" as string]: "500ms", ["--dur" as string]: "1.6s" } as React.CSSProperties}
            d="M300 96 L462 262 L300 428 L138 262 Z"
            fill="none" stroke="#1e1e1e" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"
          />
          <path
            className="draw"
            style={{ ["--len" as string]: 350, ["--d" as string]: "2.1s", ["--dur" as string]: "0.8s" } as React.CSSProperties}
            d="M300 96 V 428" fill="none" stroke="#e03131" strokeWidth="3" strokeLinecap="round"
          />
          <path
            className="draw"
            style={{ ["--len" as string]: 340, ["--d" as string]: "2.7s", ["--dur" as string]: "0.8s" } as React.CSSProperties}
            d="M138 262 H 462" fill="none" stroke="#1971c2" strokeWidth="3" strokeLinecap="round"
          />
          <g fontFamily={HAND} fontWeight="600">
            <text className="pop" style={{ ["--d" as string]: "3.1s" } as React.CSSProperties} x="314" y="176" fontSize="26" fill="#e03131">d₁</text>
            <text className="pop" style={{ ["--d" as string]: "3.3s" } as React.CSSProperties} x="384" y="250" fontSize="26" fill="#1971c2">d₂</text>
            <text className="pop" style={{ ["--d" as string]: "3.7s" } as React.CSSProperties} x="520" y="230" fontSize="40" fill="#1e1e1e">S = ½ · d₁ · d₂</text>
          </g>
          <path
            className="draw"
            style={{ ["--len" as string]: 300, ["--d" as string]: "4.2s", ["--dur" as string]: "0.8s" } as React.CSSProperties}
            d="M516 246 q 140 14 290 -2" fill="none" stroke="#2f9e44" strokeWidth="3" strokeLinecap="round"
          />
        </svg>

        {/* курсоры */}
        <div
          className="cursor-move"
          style={{ ["--path" as string]: "cur-teacher", ["--dur" as string]: "4.6s", ["--d" as string]: "300ms" } as React.CSSProperties}
        >
          <Cursor color="#1d4ed8" label="Учитель" />
        </div>
        <div
          className="cursor-move"
          style={{ ["--path" as string]: "cur-student", ["--dur" as string]: "2.6s", ["--d" as string]: "2.4s" } as React.CSSProperties}
        >
          <Cursor color="#0d9488" label="Аня Соколова" />
        </div>

        {/* левая вертикальная лента инструментов */}
        {!compact ? (
          <div className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2">
            <div className="flex flex-col items-center gap-0.5 rounded-[20px] border border-[var(--c-border-solid)] bg-white/95 p-1.5 shadow-sm backdrop-blur-[6px]">
              {RAIL_ICONS.map((I, i) => (
                <span
                  key={i}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg text-text-2 [&_svg]:size-[18px]",
                    i === 8 && "bg-primary-light text-primary",
                    (i === 1 || i === 10) && "mt-0.5",
                  )}
                >
                  <I aria-hidden />
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2">
            <div className="flex flex-col items-center gap-0.5 rounded-xl border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
              {[MousePointer2, Pencil, Eraser, Square].map((I, i) => (
                <span
                  key={i}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-lg text-text-2 [&_svg]:size-[19px]",
                    i === 1 && "bg-primary-light text-primary",
                  )}
                >
                  <I aria-hidden />
                </span>
              ))}
              <div className="my-0.5 h-px w-6 shrink-0 bg-border" aria-hidden />
              <span className="flex size-10 items-center justify-center rounded-lg text-text-2 [&_svg]:size-[19px]">
                <Hand aria-hidden />
              </span>
            </div>
          </div>
        )}

        {/* шапка доски — страницы / undo / фото / ещё / скрыть */}
        <div className="board-chrome pointer-events-none absolute right-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-xl border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
            <div className="flex items-center gap-0.5">
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-medium",
                    n === 1 ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {n}
                </span>
              ))}
            </div>
            {!compact ? (
              <span className="flex size-9 items-center justify-center rounded-[9px] text-muted-foreground [&_svg]:size-4">
                <Plus />
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-0.5 rounded-xl border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
            {(compact ? [Undo2, Redo2, MoreHorizontal] : [Undo2, Redo2, ImagePlus, MoreHorizontal]).map((I, i) => (
              <span
                key={i}
                className={cn(
                  "flex size-9 items-center justify-center rounded-[9px] text-muted-foreground [&_svg]:size-4",
                  i === 1 && "opacity-50",
                )}
              >
                <I />
              </span>
            ))}
            {!compact ? (
              <>
                <span className="mx-0.5 h-5 w-px bg-border" />
                <span className="flex size-9 items-center justify-center rounded-[9px] text-muted-foreground [&_svg]:size-4">
                  <X />
                </span>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Cursor({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-start gap-0.5">
      <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden>
        <path d="M1 1 L1 16 L5 12 L8 19 L11 18 L8 11 L14 11 Z" fill={color} stroke="#fff" strokeWidth="1" />
      </svg>
      <span
        className="mt-3 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-white"
        style={{ background: color }}
      >
        {label}
      </span>
    </div>
  );
}

/* ───────────── Задание (ActivityStage) ───────────── */

function StageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {children}
    </div>
  );
}

function StageHeader({ title, left }: { title: string; left?: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {left}
        <span className="truncate text-sm font-heavy text-foreground">{title}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <LButton variant="ghost" size="sm">
          Свернуть
        </LButton>
      </div>
    </div>
  );
}

const OPTION_ROW =
  "flex items-center gap-2.5 rounded-md border border-transparent px-2 py-2.5 text-sm transition-colors duration-300";

const OPTIONS = ["1/2", "2/3", "3/4", "4/9"];

export function TaskScene() {
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setSel(1), 1600);
    return () => clearTimeout(t);
  }, []);
  return (
    <StageFrame>
      <StageHeader
        title="Задание"
        left={
          <LBadge variant="blue" className="shrink-0">
            <Pencil className="mr-1 size-3" aria-hidden />
            пометки учителя
          </LBadge>
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto max-w-[720px] p-4">
          <div className="flex flex-col gap-3">
            {/* точки слайдов */}
            <div className="flex flex-wrap items-center" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="flex items-center justify-center p-2">
                  <span className={cn("h-1.5 rounded-full transition-all", i === 1 ? "w-6 bg-primary" : "w-3 bg-border")} />
                </span>
              ))}
            </div>

            <div className="relative flex flex-col gap-4">
              <div className="rounded-lg border-l-4 border-primary/40 bg-primary/5 p-3 text-sm">
                <div className="prose">
                  <p>
                    Чтобы сократить дробь, разделите числитель и знаменатель на их <b>общий делитель</b>.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="text-sm">
                    <p className="my-1">Сократите дробь 12/18.</p>
                  </div>
                  <LBadge variant="muted" className="shrink-0">
                    1 балл
                  </LBadge>
                </div>
                <div className="mt-3 flex flex-col gap-0.5">
                  {OPTIONS.map((o, i) => (
                    <label
                      key={o}
                      className={cn(OPTION_ROW, "relative", sel === i ? "border-primary/40 bg-accent" : "")}
                    >
                      <input
                        type="radio"
                        readOnly
                        checked={sel === i}
                        className="size-4 shrink-0 accent-[hsl(var(--primary))]"
                        tabIndex={-1}
                      />
                      <span>{o}</span>
                      {sel === i ? (
                        <svg className="pointer-events-none absolute -inset-1 size-[calc(100%+8px)] overflow-visible" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
                          <path
                            className="draw"
                            style={{ ["--len" as string]: 300, ["--d" as string]: "500ms", ["--dur" as string]: "0.9s" } as React.CSSProperties}
                            d="M50 2 C 84 0, 99 6, 98 15 C 97 25, 72 29, 48 28 C 20 28, 2 24, 3 14 C 4 5, 26 1, 60 2"
                            fill="none" stroke="#e03131" strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke"
                          />
                        </svg>
                      ) : null}
                    </label>
                  ))}
                </div>
              </div>

            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
              <LButton variant="outline" size="sm" className="h-10">
                <ChevronLeft aria-hidden />
                Назад
              </LButton>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">Слайд 2 из 5</span>
              <LButton variant="outline" size="sm" className="h-10">
                Дальше
                <ChevronRight aria-hidden />
              </LButton>
            </div>
          </div>
        </div>
      </div>
    </StageFrame>
  );
}

/* ───────────── Прогресс класса (ActivityTeacherTabs + ClassProgressPanel) ───────────── */

function statusOf(r: ProgressRow): "done" | "not_started" | "in_progress" | "stuck" {
  if (r.status === "in_progress" && r.answered >= r.total) return "done";
  return r.status;
}

const STATUS_BADGE = {
  not_started: { label: "не начал", v: "gray" },
  in_progress: { label: "в работе", v: "blue" },
  stuck: { label: "застрял", v: "yellow" },
  done: { label: "в работе", v: "blue" },
} as const;

/** «Живой» опрос: каждые ~1.3 с кто-то из класса отвечает на очередной вопрос. */
export function useLiveProgress() {
  const [rows, setRows] = useState<ProgressRow[]>(PROGRESS_START);
  const live = useLive();
  useEffect(() => {
    if (!live) return;
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setRows((prev) => {
        const idx = [4, 1, 5, 0, 7, 3, 2][n % 7]!;
        return prev.map((r, i) => {
          if (i !== idx || r.answered >= r.total) return r;
          const answered = r.answered + 1;
          return { ...r, answered, status: "in_progress" as const };
        });
      });
    }, 1300);
    return () => clearInterval(id);
  }, [live]);
  return rows;
}

export function ProgressScene({ compact = false }: { compact?: boolean }) {
  const rows = useLiveProgress();
  const counts = { done: 0, in_progress: 0, stuck: 0, not_started: 0 };
  for (const r of rows) counts[statusOf(r)] += 1;
  const list = compact ? rows.slice(0, 5) : rows;

  return (
    <StageFrame>
      <StageHeader title="Задание — класс" />
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto max-w-[760px] p-4">
          {!compact ? (
            <p className="mb-3 text-xs text-muted-foreground">
              Во вкладке «Прогресс» нажмите на ученика — откроется его материал с текущими ответами.
            </p>
          ) : null}
          <div className="space-y-3">
            <div className="inline-flex items-center justify-center gap-0.5 rounded-[11px] bg-surface-3 p-1 text-muted-foreground">
              {["Прогресс", "Аналитика", "Разбор", "Проверка"].map((t, i) => (
                <span
                  key={t}
                  className={cn(
                    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-semibold",
                    i === 0 && "bg-card text-foreground shadow-xs",
                    compact && i > 1 && "hidden",
                  )}
                >
                  {t}
                </span>
              ))}
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <Stat label="ответили" value={counts.done} cls="bg-success-light text-success" />
                <Stat label="в работе" value={counts.in_progress} cls="bg-primary-light text-primary" />
                <Stat label="застряли" value={counts.stuck} cls="bg-warn-light text-warn" />
                <Stat label="не начали" value={counts.not_started} cls="bg-surface-3 text-muted-foreground" />
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full caption-bottom text-sm">
                  <thead className="[&_tr]:border-b [&_tr]:border-border">
                    <tr>
                      <th className="h-9 px-3 text-left align-middle text-xs font-medium text-muted-foreground">Ученик</th>
                      <th className="h-9 w-28 px-3 text-left align-middle text-xs font-medium text-muted-foreground">Статус</th>
                      <th className="h-9 w-20 px-3 text-right align-middle text-xs font-medium text-muted-foreground">Ответы</th>
                      <th className="h-9 w-8 px-3" />
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child]:border-0">
                    {list.map((r) => {
                      const st = statusOf(r);
                      const meta = STATUS_BADGE[st];
                      return (
                        <tr key={r.name} className="cursor-pointer border-b border-border">
                          <td className="px-3 py-2 align-middle">
                            <span className="flex items-center gap-2 font-medium">
                              <UserAvatar name={r.name} size={24} />
                              {r.name}
                            </span>
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <LBadge variant={meta.v}>{meta.label}</LBadge>
                          </td>
                          <td className="px-3 py-2 text-right align-middle text-xs font-medium text-muted-foreground tabular-nums">
                            {r.answered}/{r.total}
                          </td>
                          <td className="px-3 py-2 align-middle text-muted-foreground">
                            <ChevronRight className="size-4" aria-hidden />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </StageFrame>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 font-semibold tabular-nums", cls)}>
      {value} {label}
    </span>
  );
}

/* ───────────── Боковая панель (drawer) ───────────── */

const TAB = (active: boolean) =>
  cn(
    "inline-flex h-[34px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-[13.5px] font-semibold",
    active ? "bg-primary-light text-primary" : "text-text-2",
  );

export function Drawer({ tab }: { tab: "people" | "chat" }) {
  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-r border-border bg-card">
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-border p-2.5">
        <span className={TAB(tab === "people")}>Участники</span>
        <span className={TAB(tab === "chat")}>
          Чат
          {tab !== "chat" ? (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
              3
            </span>
          ) : null}
        </span>
        <span className={TAB(false)}>Материалы</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{tab === "people" ? <PeoplePanel /> : <ChatPanel />}</div>
    </aside>
  );
}

function PeoplePanel() {
  const rows = PEOPLE.slice(0, 9);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2.5">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" aria-hidden />
          <span className="flex h-9 w-full items-center rounded-md border border-border bg-card pl-9 text-sm text-muted-foreground shadow-xs">
            Найти участника
          </span>
        </label>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-[.07em] text-text-3">В уроке · {PEOPLE.length}</span>
          <span className="flex h-7 items-center rounded-full border border-border bg-card px-2.5 text-[12.5px] font-semibold text-text-2">
            Заглушить всех
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 px-2 pb-2.5 pt-1.5">
        {rows.map((p, i) => {
          const hint = p.self ? "вы · ведёт урок" : p.hand ? "поднял(а) руку" : p.weak ? "плохая связь" : null;
          return (
            <div
              key={p.id}
              className="slide-in flex items-center gap-2.5 rounded-[10px] p-2"
              style={{ ["--d" as string]: `${i * 45}ms` } as React.CSSProperties}
            >
              <UserAvatar name={p.name} size={32} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
                  {p.teacher ? (
                    <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-primary-light px-[7px] text-[11px] font-semibold text-primary">
                      учитель
                    </span>
                  ) : null}
                  {p.hand ? <Hand className="size-3.5 shrink-0 text-warning" aria-label="Поднята рука" /> : null}
                </span>
                {hint ? <span className="truncate text-xs text-text-3">{hint}</span> : null}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-text-3">
                {p.micOff ? <MicOff className="size-[15px]" aria-label="Микрофон выключен" /> : null}
                {!p.self ? (
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] text-text-3">
                    <MoreHorizontal className="size-4" aria-hidden />
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChatPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex flex-col gap-3 px-3 py-3.5">
          {CHAT.map((m, i) => (
            <div key={i} className="slide-in flex flex-col gap-[3px]" style={{ ["--d" as string]: `${i * 700}ms` } as React.CSSProperties}>
              <span className="flex items-baseline gap-2">
                <span className="truncate text-[13px] font-semibold text-foreground">{m.who}</span>
                <span className="shrink-0 text-[11.5px] text-text-3">{m.at}</span>
              </span>
              <span className="self-start whitespace-pre-wrap break-words rounded-[10px] bg-surface-2 px-2.5 py-2 text-sm text-foreground">
                {m.body}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 gap-2 border-t border-border p-2.5">
        <span className="flex h-[38px] w-full items-center rounded-md border border-border bg-card px-3.5 text-sm text-muted-foreground shadow-xs">
          Сообщение классу…
        </span>
        <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
          <MessageSquare className="size-4" aria-hidden />
        </span>
      </div>
    </div>
  );
}
