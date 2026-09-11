import {
  Hand,
  MessageSquare,
  Mic,
  MonitorUp,
  PenLine,
  Users,
  Video,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { GradCap } from "./Logo";

/**
 * Макет «холста урока» — главный визуал героя. Собран из тех же примитивов
 * дизайн-системы, что и приложение: карточки, скругления, синий primary,
 * мягкие тени. Не скриншот — живая вёрстка (адаптив + анимация).
 */
export function ProductMock({ className }: { className?: string }) {
  return (
    <div className={cn("relative w-full overflow-hidden bg-card", className)}>
      {/* ── Шапка урока ── */}
      <div className="flex items-center gap-2.5 border-b border-border bg-card px-4 py-2.5">
        <span className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
          <GradCap className="size-3.5" />
        </span>
        <span className="truncate text-[13px] font-heavy tracking-head text-foreground">
          Алгебра, 8 класс — квадратные уравнения
        </span>
        <span className="ml-1 inline-flex items-center gap-1.5 text-[11px] font-semibold text-success">
          <span className="size-1.5 rounded-full bg-success" />
          На связи
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-pill bg-danger-light px-2 py-0.5 text-[10px] font-semibold text-danger">
          <span className="size-1.5 animate-pulse rounded-full bg-danger" />
          Запись
        </span>
        <span className="hidden rounded-pill bg-primary-light px-2 py-0.5 text-[10px] font-semibold text-primary sm:inline">
          Обсуждение
        </span>
      </div>

      <div className="flex min-h-[300px] gap-2 p-2 sm:min-h-[360px] sm:p-3">
        {/* ── Левая мини-панель инструментов ── */}
        <div className="hidden shrink-0 flex-col items-center gap-2 rounded-xl border border-border bg-surface-2 px-1.5 py-2.5 sm:flex">
          {[Wrench, Users, MessageSquare].map((Icon, i) => (
            <span
              key={i}
              className={cn(
                "grid size-8 place-items-center rounded-lg text-muted-foreground",
                i === 0 && "bg-primary-light text-primary",
              )}
            >
              <Icon className="size-4" />
            </span>
          ))}
        </div>

        {/* ── Доска ── */}
        <div className="relative flex-1 overflow-hidden rounded-xl border border-border bg-white">
          <Whiteboard />

          {/* Плавающая карточка задания */}
          <div className="absolute bottom-3 left-3 w-[62%] max-w-[280px] rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
                Задание · вопрос 3 из 6
              </span>
              <span className="rounded-pill bg-primary-light px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                2 балла
              </span>
            </div>
            <p className="mt-1.5 text-[12px] font-medium text-foreground">
              Сколько корней у уравнения при D&nbsp;&lt;&nbsp;0?
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {["Два", "Один", "Ни одного", "Бесконечно"].map((o, i) => (
                <span
                  key={o}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px]",
                    i === 2
                      ? "border-success bg-success-light font-semibold text-success"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {o}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Лента камер ── */}
        <div className="flex w-[76px] shrink-0 flex-col gap-2 sm:w-[104px]">
          <VideoTile name="Т. Учителев" initials="ТУ" speaking />
          <VideoTile name="Аня" initials="А" />
          <VideoTile name="Максим" initials="М" muted />
          <div className="grid flex-1 place-items-center rounded-xl border border-dashed border-border text-[10px] font-medium text-text-3">
            +14
          </div>
        </div>
      </div>

      {/* ── Нижняя панель управления ── */}
      <div className="flex items-center justify-center gap-2 border-t border-border bg-card px-3 py-2.5">
        <ControlPill icon={Mic} label="Микрофон" speaking />
        <ControlPill icon={Video} label="Камера" />
        <ControlPill icon={PenLine} label="Доска" primary />
        <ControlPill icon={MonitorUp} label="Демонстрация" />
        <ControlPill icon={Hand} label="Рука" />
      </div>
    </div>
  );
}

function Whiteboard() {
  return (
    <svg viewBox="0 0 420 260" className="size-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <pattern id="wb-grid" width="26" height="26" patternUnits="userSpaceOnUse">
          <path d="M26 0H0V26" fill="none" stroke="rgba(16,24,40,0.05)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="420" height="260" fill="url(#wb-grid)" />

      {/* формула */}
      <rect x="22" y="24" width="204" height="24" rx="4" fill="#f5d90a" opacity="0.3" />
      <text x="28" y="42" fontSize="18" fontWeight="700" fill="#101828" fontFamily="ui-monospace, monospace">
        x = (-b ± √D) / 2a
      </text>

      {/* оси координат */}
      <path d="M44 150 H 316" stroke="#cbd2dd" strokeWidth="1.5" />
      <path d="M150 60 V 232" stroke="#cbd2dd" strokeWidth="1.5" />

      {/* парабола y = x², открыта вверх, пересекает ось в двух точках */}
      <path
        d="M70 72 C 100 240, 200 240, 230 72"
        fill="none"
        stroke="#1d4ed8"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* корни — красным «от руки» */}
      <circle cx="99" cy="150" r="5.5" fill="none" stroke="#dc2626" strokeWidth="2.5" />
      <circle cx="201" cy="150" r="5.5" fill="none" stroke="#dc2626" strokeWidth="2.5" />
      <text x="256" y="186" fontSize="12" fill="#dc2626" fontWeight="600" transform="rotate(-4 256 186)">
        два корня, D &gt; 0
      </text>
      <path d="M250 176 q -18 -6 -30 4" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" />

      {/* курсор ученика */}
      <g transform="translate(232 92)">
        <path d="M0 0 L0 16 L4.5 12 L7.5 18 L10 17 L7 11 L13 11 Z" fill="#0d9488" />
        <rect x="14" y="12" width="44" height="15" rx="7" fill="#0d9488" />
        <text x="20" y="23" fontSize="9" fill="#fff" fontWeight="600">Аня</text>
      </g>
    </svg>
  );
}

function VideoTile({
  name,
  initials,
  speaking,
  muted,
}: {
  name: string;
  initials: string;
  speaking?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative aspect-square overflow-hidden rounded-xl border bg-[#0b1220] ring-2 transition-shadow",
        speaking ? "border-primary ring-primary/60" : "border-border ring-transparent",
      )}
    >
      <div className="grid size-full place-items-center">
        <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-primary to-teal text-[12px] font-bold text-white sm:size-9">
          {initials}
        </span>
      </div>
      <span className="absolute inset-x-1 bottom-1 flex items-center gap-1 rounded-md bg-black/55 px-1 py-0.5 text-[9px] font-medium text-white backdrop-blur">
        {muted ? <span className="text-white/60">🔇</span> : null}
        <span className="truncate">{name}</span>
      </span>
      {speaking ? (
        <span className="absolute right-1 top-1 size-2 rounded-full bg-success shadow-[0_0_0_3px_rgba(34,197,94,0.35)]" />
      ) : null}
    </div>
  );
}

function ControlPill({
  icon: Icon,
  label,
  speaking,
  primary,
}: {
  icon: typeof Mic;
  label: string;
  speaking?: boolean;
  primary?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative grid size-9 place-items-center rounded-full border transition-colors",
        primary
          ? "border-primary-muted bg-primary-light text-primary"
          : "border-border bg-card text-foreground shadow-xs",
        speaking && "ring-2 ring-success ring-offset-1",
      )}
      title={label}
    >
      <Icon className="size-4" />
    </span>
  );
}
