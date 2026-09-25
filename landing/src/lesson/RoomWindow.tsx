import { useEffect, useRef, useState } from "react";
import {
  ClipboardList,
  Clock,
  GraduationCap,
  Hand,
  LogOut,
  Link as LinkIcon,
  MessageSquare,
  Mic,
  MoreHorizontal,
  MonitorUp,
  PenLine,
  Settings,
  Users,
  Video,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { PEOPLE } from "./data";
import { useInView } from "@/hooks/useInView";
import { ControlPill, ControlTile, IconBtn, LButton, LiveContext, RecordingPill, StatusPill, useLive } from "./parts";
import { BoardScene, Drawer, ProgressScene, TaskScene, TileRail, TileStrip, VideoGrid } from "./scenes";

export type Scene = "people" | "board" | "task" | "progress";
export type DrawerTab = "people" | "chat" | null;

export const DESKTOP_W = 1280;
export const DESKTOP_H = 720;
export const PHONE_W = 390;
export const PHONE_H = 720;

/**
 * Масштабирует окно фиксированного размера под ширину родителя (и, если задан
 * `reserveH`, под высоту экрана) — transform, без перерасчёта вёрстки.
 */
export function FitBox({
  width,
  height,
  maxScale = 1,
  reserveH,
  className,
  children,
}: {
  width: number;
  height: number;
  maxScale?: number;
  /** Сколько пикселей высоты экрана оставить под остальное (шапка, подписи). */
  reserveH?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const calc = () => {
      const byW = el.getBoundingClientRect().width / width;
      const byH = reserveH ? (window.innerHeight - reserveH) / height : Infinity;
      setScale(Math.max(0.2, Math.min(maxScale, byW, byH)));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    window.addEventListener("resize", calc);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", calc);
    };
  }, [width, height, maxScale, reserveH]);
  return (
    <div ref={ref} className={cn("w-full", className)}>
      <div style={{ width: width * scale, height: height * scale, marginInline: "auto" }}>
        <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}>{children}</div>
      </div>
    </div>
  );
}

const ICON_BADGE = (n: number, primary = false) => (
  <span
    className={cn(
      "absolute -right-px -top-px flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] text-[11px] font-bold",
      primary ? "bg-primary text-primary-foreground" : "bg-surface-3 text-text-2",
    )}
  >
    {n}
  </span>
);

/** Окно урока в десктопной раскладке (RoomPage: шапка + [drawer] + стейдж + футер). */
export function RoomWindow({
  scene,
  drawer = null,
  className,
}: {
  scene: Scene;
  drawer?: DrawerTab;
  className?: string;
}) {
  const railed = scene !== "people";
  const stage =
    scene === "people" ? (
      <VideoGrid cols={drawer ? 3 : 4} max={drawer ? 9 : 12} />
    ) : scene === "board" ? (
      <BoardScene />
    ) : scene === "task" ? (
      <TaskScene />
    ) : (
      <ProgressScene />
    );

  const { ref, inView } = useInView<HTMLDivElement>("0px");
  const visible = useDocVisible();
  return (
    <LiveContext.Provider value={inView && visible}>
    <div
      ref={ref}
      className={cn("lesson-ui flex flex-col overflow-hidden bg-background text-foreground", className)}
      style={{ width: DESKTOP_W, height: DESKTOP_H }}
    >
      {/* Шапка */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur-md">
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
          <GraduationCap className="size-[17px]" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-bold leading-tight tracking-[-.02em]">Алгебра · 8 класс</span>
          <span className="truncate text-xs leading-tight text-muted-foreground">
            начало 10:00 · {PEOPLE.length} участников
          </span>
        </span>
        <StatusPill />
        <RecordingPill />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <LButton variant="secondary" className="h-9 rounded-[10px] px-3.5 text-[13.5px]">
            <LinkIcon aria-hidden />
            Пригласить
          </LButton>
          <span className="flex size-9 items-center justify-center rounded-[10px] text-muted-foreground">
            <Settings className="size-[18px]" aria-hidden />
          </span>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {drawer ? <Drawer tab={drawer} /> : null}
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3.5">
          <div key={scene + (drawer ?? "")} className="scene-in flex min-h-0 flex-1 gap-3">
            <div className="min-h-0 min-w-0 flex-1">{stage}</div>
            {railed ? <TileRail /> : null}
          </div>
        </main>
      </div>

      {/* Футер */}
      <footer className="flex h-[76px] shrink-0 items-center justify-between gap-4 border-t border-border bg-card px-4">
        <div className="flex min-w-[200px] shrink-0 items-center gap-1.5">
          <IconBtn icon={Users} pressed={drawer === "people"} badge={ICON_BADGE(PEOPLE.length)} />
          <IconBtn icon={MessageSquare} pressed={drawer === "chat"} badge={drawer === "chat" ? null : ICON_BADGE(3, true)} />
          <IconBtn icon={ClipboardList} />
          <IconBtn icon={MoreHorizontal} />
        </div>

        <div className="flex min-w-0 items-center gap-2.5">
          <ControlPill icon={Mic} label="Микрофон" settings />
          <ControlPill icon={Video} label="Камера" settings />
          <span className="mx-0.5 h-8 w-px shrink-0 bg-border" aria-hidden />
          <ControlPill icon={MonitorUp} label="Экран" tone="action" active={false} />
          <ControlPill icon={PenLine} label="Доска" tone="action" active={scene === "board"} />
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 shrink-0 items-center gap-[7px] rounded-full bg-surface-2 px-3 font-mono text-[12.5px] font-semibold text-text-2">
              <Clock className="size-3.5" aria-hidden />
              <Elapsed />
            </span>
            <span className="truncate text-[12.5px] text-text-3">Режим: лекция</span>
          </div>
          <LButton variant="destructive" className="h-11 gap-2 rounded-full px-[18px] text-[15px] [&_svg]:size-[19px]">
            <LogOut aria-hidden />
            Выйти
          </LButton>
        </div>
      </footer>
    </div>
    </LiveContext.Provider>
  );
}

function useDocVisible() {
  const [v, setV] = useState(true);
  useEffect(() => {
    const on = () => setV(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return v;
}

/** Таймер урока — тикает с 24:07, как живой. */
function Elapsed() {
  const [s, setS] = useState(24 * 60 + 7);
  const live = useLive();
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setS((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [live]);
  return <span className="tabular-nums">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</span>;
}

/** Окно урока на телефоне (RoomPage: шапка md:hidden + фокус-плитка/стейдж + лента + футер-плитки). */
export function PhoneWindow({ scene, className }: { scene: Scene; className?: string }) {
  const { ref, inView } = useInView<HTMLDivElement>("0px");
  const visible = useDocVisible();
  return (
    <LiveContext.Provider value={inView && visible}>
    <div
      ref={ref}
      className={cn("lesson-ui flex flex-col overflow-hidden bg-background text-foreground", className)}
      style={{ width: PHONE_W, height: PHONE_H }}
    >
      <header className="flex shrink-0 items-center gap-2 px-3.5 pb-2.5 pt-3">
        <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[9px] bg-primary text-primary-foreground">
          <GraduationCap className="size-[15px]" aria-hidden />
        </span>
        <span className="min-w-0 truncate text-[13.5px] font-bold">Алгебра · 8 класс</span>
        <StatusPill compact />
        <RecordingPill compact />
        <span className="ml-auto flex size-[30px] shrink-0 items-center justify-center rounded-[9px] text-muted-foreground">
          <MoreHorizontal className="size-[18px]" aria-hidden />
        </span>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3">
        <div key={scene} className="scene-in flex min-h-0 flex-1 flex-col gap-2">
          <div className="min-h-0 flex-1">
            {scene === "people" ? (
              <div className="flex h-full min-h-0 flex-col gap-2">
                <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-2xl bg-slate-900">
                  <PhoneFocus />
                </div>
                <TileStrip from={1} />
              </div>
            ) : scene === "board" ? (
              <BoardScene compact />
            ) : scene === "task" ? (
              <TaskScene />
            ) : (
              <ProgressScene compact />
            )}
          </div>
          {scene !== "people" ? <TileStrip from={1} /> : null}
        </div>
      </main>

      <footer className="flex shrink-0 flex-col gap-2.5 px-3 pb-5 pt-3.5">
        <div className="flex items-stretch gap-2">
          <ControlTile icon={Mic} label="Микрофон" />
          <ControlTile icon={Video} label="Камера" />
          <ControlTile icon={Hand} label="Рука" tone="action" active={false} />
          <ControlTile icon={MessageSquare} label="Чат" tone="action" active={false} badge={3} />
        </div>
        <span className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#fecaca] bg-danger-light text-[15px] font-semibold text-danger">
          <LogOut className="size-[18px]" aria-hidden />
          Выйти из урока
        </span>
      </footer>
    </div>
    </LiveContext.Provider>
  );
}

function PhoneFocus() {
  return (
    <>
      <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden>
        <rect width="160" height="90" fill="#3f3a52" />
        <circle cx="80" cy="38" r="15" fill="#a5a0c0" />
        <path d="M46 92c2-20 16-30 34-30s32 10 34 30Z" fill="#a5a0c0" />
      </svg>
      <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-inset ring-primary" aria-hidden />
      <span className="pointer-events-none absolute left-2.5 top-2.5 inline-flex h-6 items-center rounded-full bg-primary px-2.5 text-xs font-semibold text-primary-foreground">
        говорит
      </span>
      <span className="absolute right-2.5 top-2.5 flex size-[26px] items-center justify-center rounded-full bg-warning text-warning-foreground">
        <Hand className="size-3.5" aria-label="Поднята рука" />
      </span>
      <span className="pointer-events-none absolute bottom-2.5 left-2.5 inline-flex h-6 max-w-[calc(100%-20px)] items-center gap-1.5 rounded-full bg-[rgba(16,24,40,.72)] px-[9px] text-xs font-medium text-white">
        <span className="truncate">Марина Петровна · учитель</span>
      </span>
    </>
  );
}
