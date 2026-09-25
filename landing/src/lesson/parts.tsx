/**
 * Статичные копии элементов интерфейса урока из apps/web — разметка и классы
 * перенесены дословно (RoomVideoGrid, RoomControlButton, RoomPage, ClassProgressPanel…),
 * без LiveKit и данных. Меняя интерфейс урока, синхронизируйте отсюда.
 */
import * as React from "react";
import {
  ChevronUp,
  Hand,
  MicOff,
  Pin,
  SignalLow,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/* ───────────── Avatar / Badge (shared/ui) ───────────── */

export function initialsOf(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function UserAvatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      className={cn("relative flex shrink-0 overflow-hidden rounded-full", className)}
      style={{ width: size, height: size }}
    >
      <span
        className="flex size-full items-center justify-center rounded-full bg-gradient-to-br from-primary-light to-teal-light font-bold text-primary"
        style={{ fontSize: Math.round(size * 0.38) }}
      >
        {initialsOf(name)}
      </span>
    </span>
  );
}

const BADGE = {
  blue: "bg-primary-light text-primary",
  green: "bg-success-light text-success",
  yellow: "bg-warn-light text-warn",
  red: "bg-danger-light text-danger",
  gray: "bg-surface-3 text-muted-foreground",
  muted: "bg-surface-3 text-muted-foreground",
} as const;

export function LBadge({
  variant = "blue",
  className,
  children,
}: {
  variant?: keyof typeof BADGE;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-0.5 text-xs font-semibold [&_svg]:size-3 [&_svg]:shrink-0",
        BADGE[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Button из shared/ui — только то, что встречается в уроке. */
export function LButton({
  variant = "default",
  size = "default",
  className,
  children,
}: {
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "icon-sm";
  className?: string;
  children: React.ReactNode;
}) {
  const v = {
    default: "bg-primary text-primary-foreground shadow-xs",
    secondary: "border border-border bg-card text-foreground shadow-xs",
    outline: "border border-border bg-transparent text-foreground",
    ghost: "text-muted-foreground",
    destructive: "bg-destructive text-destructive-foreground shadow-xs",
  }[variant];
  const s = {
    default: "h-10 px-4 py-2 text-[15px]",
    sm: "h-8 rounded-[9px] px-3 text-[13.5px] gap-1.5",
    "icon-sm": "size-8 rounded-[9px]",
  }[size];
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold [&_svg]:size-4 [&_svg]:shrink-0",
        v,
        s,
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ───────────── Шапка ───────────── */

const STATUS_TONE = {
  connected: "bg-success-light text-success",
  connecting: "bg-warn-light text-[#b45309]",
} as const;

export function StatusPill({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-semibold",
        compact ? "h-[22px] gap-[5px] px-2 text-[11px]" : "ml-2 h-[26px] gap-1.5 px-2.5 text-xs",
        STATUS_TONE.connected,
      )}
    >
      <span className={cn("rounded-full bg-current", compact ? "size-[5px]" : "size-1.5")} />
      На связи
    </span>
  );
}

export function RecordingPill({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-danger-light font-semibold text-danger",
        compact ? "h-[22px] gap-[5px] px-2 text-[11px]" : "h-[26px] gap-1.5 px-2.5 text-xs",
      )}
    >
      <span className={cn("animate-pulse rounded-full bg-current", compact ? "size-[5px]" : "size-1.5")} />
      Запись
    </span>
  );
}

/* ───────────── Кнопки панели (RoomControlButton) ───────────── */

function surfaceOf(active: boolean, tone: "media" | "action") {
  const alarm = tone === "media" && !active;
  const highlighted = tone === "action" && active;
  return {
    alarm,
    cls: alarm
      ? "border-destructive bg-destructive text-destructive-foreground"
      : highlighted
        ? "border-primary-muted bg-primary-light text-primary"
        : "border-border bg-card text-foreground",
  };
}

export function ControlPill({
  icon: Icon,
  label,
  active = true,
  tone = "media",
  settings = false,
  speaking = false,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  tone?: "media" | "action";
  settings?: boolean;
  speaking?: boolean;
}) {
  const { alarm, cls } = surfaceOf(active, tone);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center overflow-hidden rounded-full border shadow-xs transition-colors",
        cls,
        speaking && "ring-2 ring-success ring-offset-1",
      )}
    >
      <span className="inline-flex h-12 items-center gap-2 px-3.5 text-[15px] font-semibold lg:px-[18px] [&_svg]:size-5 [&_svg]:shrink-0">
        <Icon aria-hidden />
        <span className="whitespace-nowrap">{label}</span>
      </span>
      {settings ? (
        <>
          <span aria-hidden className={cn("h-[26px] w-px", alarm ? "bg-white/30" : "bg-border")} />
          <span
            className={cn(
              "flex h-12 w-9 items-center justify-center [&_svg]:size-4",
              alarm ? "text-white/80" : "text-text-3",
            )}
          >
            <ChevronUp aria-hidden />
          </span>
        </>
      ) : null}
    </span>
  );
}

export function ControlTile({
  icon: Icon,
  label,
  active = true,
  tone = "media",
  badge,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  tone?: "media" | "action";
  badge?: number;
}) {
  const { cls } = surfaceOf(active, tone);
  return (
    <span
      className={cn(
        "relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-[3px] rounded-2xl border text-[11.5px] font-semibold leading-none [&_svg]:size-[21px] [&_svg]:shrink-0",
        cls,
      )}
    >
      <Icon aria-hidden />
      <span className="max-w-full truncate px-1">{label}</span>
      {badge ? (
        <span className="absolute right-2.5 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
          {badge}
        </span>
      ) : null}
    </span>
  );
}

/** ICON_BTN футера: круглая иконка слева (участники / чат / материалы / ещё). */
export function IconBtn({
  icon: Icon,
  pressed = false,
  badge,
}: {
  icon: LucideIcon;
  pressed?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "relative flex size-11 items-center justify-center rounded-full text-text-2 [&_svg]:size-5",
        pressed && "bg-surface-3 text-foreground",
      )}
    >
      <Icon aria-hidden />
      {badge}
    </span>
  );
}

/* ───────────── Плитка участника (RoomVideoGrid.renderTile) ───────────── */

export type TileSize = "lg" | "md" | "sm" | "xs";

const ROLE_SUFFIX: Record<string, string> = { teacher: "учитель" };

export type TileProps = {
  name: string;
  size?: TileSize;
  className?: string;
  speaking?: boolean;
  hand?: boolean;
  pinned?: boolean;
  micOff?: boolean;
  weak?: boolean;
  self?: boolean;
  role?: "teacher";
  /** Есть ли «видео» (в живом уроке — поток камеры; здесь — обезличенный силуэт). */
  video?: "a" | "b" | "c";
  /** Задержка появления «говорит» (мс) — для сценариев. */
  speakAt?: number;
};

const VIDEO_TONES = {
  a: { bg: "#334155", fg: "#94a3b8" },
  b: { bg: "#3f3a52", fg: "#a5a0c0" },
  c: { bg: "#2f4a4c", fg: "#93b7b4" },
} as const;

function Silhouette({ tone }: { tone: keyof typeof VIDEO_TONES }) {
  const t = VIDEO_TONES[tone];
  return (
    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden>
      <rect width="160" height="90" fill={t.bg} />
      <circle cx="80" cy="38" r="15" fill={t.fg} />
      <path d="M46 92c2-20 16-30 34-30s32 10 34 30Z" fill={t.fg} />
    </svg>
  );
}

export function Tile({
  name,
  size = "lg",
  className,
  speaking,
  hand,
  pinned,
  micOff,
  weak,
  self,
  role,
  video,
  speakAt,
}: TileProps) {
  const small = size === "sm" || size === "xs";
  const roleSuffix = role ? ROLE_SUFFIX[role] : undefined;
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-slate-900",
        size === "lg" ? "rounded-2xl" : "rounded-xl",
        className,
      )}
    >
      {video ? (
        <Silhouette tone={video} />
      ) : (
        <span
          className={cn(
            "flex items-center justify-center rounded-full bg-white/10 font-bold text-white",
            size === "lg" && "size-14 text-lg",
            size === "md" && "size-11 text-[15px]",
            size === "sm" && "size-[34px] text-xs",
            size === "xs" && "size-[30px] text-[11px]",
          )}
        >
          {initialsOf(name)}
        </span>
      )}

      {speaking ? (
        <span
          className={cn("pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-inset ring-primary", speakAt !== undefined && "speak-ring")}
          style={speakAt !== undefined ? ({ ["--d" as string]: `${speakAt}ms`, opacity: 0 } as React.CSSProperties) : undefined}
          aria-hidden
        />
      ) : null}

      {speaking && (size === "lg" || size === "md") ? (
        <span
          className={cn(
            "pointer-events-none absolute left-2.5 top-2.5 inline-flex h-6 items-center rounded-full bg-primary px-2.5 text-xs font-semibold text-primary-foreground",
            speakAt !== undefined && "speak-ring",
          )}
          style={speakAt !== undefined ? ({ ["--d" as string]: `${speakAt}ms`, opacity: 0 } as React.CSSProperties) : undefined}
        >
          говорит
        </span>
      ) : null}

      {hand || pinned ? (
        <span className={cn("absolute flex gap-1", small ? "right-1.5 top-1.5" : "right-2.5 top-2.5")}>
          {hand ? (
            <span
              className={cn(
                "pop flex items-center justify-center rounded-full bg-warning text-warning-foreground",
                small ? "size-5" : "size-[26px]",
              )}
              style={{ ["--d" as string]: "1.2s" } as React.CSSProperties}
            >
              <Hand className={small ? "size-3" : "size-3.5"} aria-label="Поднята рука" />
            </span>
          ) : null}
          {pinned ? (
            <span
              className={cn(
                "flex items-center justify-center rounded-full bg-primary text-primary-foreground",
                small ? "size-5" : "size-[26px]",
              )}
            >
              <Pin className={small ? "size-3" : "size-3.5"} aria-label="Закреплён" />
            </span>
          ) : null}
        </span>
      ) : null}

      {size !== "xs" ? (
        <span
          className={cn(
            "pointer-events-none absolute inline-flex items-center rounded-full bg-[rgba(16,24,40,.72)] font-medium text-white",
            size === "lg" && "bottom-2.5 left-2.5 h-6 max-w-[calc(100%-20px)] gap-1.5 px-[9px] text-xs",
            size === "md" && "bottom-2 left-2 h-[22px] max-w-[calc(100%-16px)] gap-[5px] px-2 text-[11.5px]",
            size === "sm" && "bottom-2 left-2 h-5 max-w-[calc(100%-16px)] gap-1 px-[7px] text-[11px]",
          )}
        >
          {micOff ? <MicOff className="size-3 shrink-0 text-red-300" aria-label="Микрофон выключен" /> : null}
          {weak ? <SignalLow className="size-3 shrink-0 text-amber-400" aria-label="Плохая связь" /> : null}
          <span className="truncate">
            {name}
            {self ? " (вы)" : size === "lg" && roleSuffix ? ` · ${roleSuffix}` : ""}
          </span>
        </span>
      ) : null}
    </div>
  );
}

/* ───────────── Прочее ───────────── */

/** Круглый нейтральный «Сообщений пока нет»/«ещё N» — кнопка колонки. */
export function RailMore({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border bg-card text-xs font-semibold text-text-2">
      {children}
    </span>
  );
}

/** Идёт ли «жизнь» в окне урока (таймер, живой прогресс): false, когда окно вне экрана или вкладка скрыта. */
export const LiveContext = React.createContext(true);
export const useLive = () => React.useContext(LiveContext);
