import { useId } from "react";
import type { ParticipantSnapshot } from "@school/shared";

import { cn } from "@/lib/utils";
import { BrandMark } from "@/shared/ui/brand-mark";
import { initialsOf } from "@/shared/ui/avatar";

/**
 * Фоны плиток без видео — сплошные оттенки фирменных синего и бирюзового
 * (--c-primary, --c-teal и их ступени), все с контрастом ≥ 4.5:1 к белому.
 * Цвет закреплён за участником (хеш id): у всех одинаков и не меняется
 * между включениями камеры.
 */
const TINTS = ["#1d4ed8", "#0d9488", "#1e40af", "#0f766e", "#2563eb", "#115e59", "#1e3a8a", "#0e7490"];

function tintOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return TINTS[Math.abs(h) % TINTS.length];
}

type Size = "lg" | "md" | "sm" | "xs";

const MARK_SIZE: Record<Size, string> = {
  lg: "size-24",
  md: "size-16",
  sm: "size-[34px]",
  xs: "size-10",
};

const INITIALS_SIZE: Record<Size, string> = {
  lg: "text-base",
  md: "text-sm",
  sm: "text-[11px]",
  xs: "text-[11px]",
};

/**
 * Плитка участника с выключенной камерой: фирменный цвет, знак «Матис» по
 * роли (ученик — в шапочке, учитель и методист — с галстуком, администратор —
 * обычный знак) и инициалы.
 */
export function ParticipantPlaceholder({
  participant,
  size,
}: {
  participant: Pick<ParticipantSnapshot, "userId" | "fullName" | "kind" | "role">;
  size: Size;
}) {
  const markClass = cn("text-white", MARK_SIZE[size]);
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-0 flex flex-col items-center justify-center",
        size === "sm" ? "gap-1" : "gap-1.5",
      )}
      style={{ backgroundColor: tintOf(participant.userId) }}
      aria-hidden
    >
      {participant.kind === "guest" ? (
        <StudentMark className={markClass} />
      ) : participant.role === "admin" ? (
        // Квадратный знак без головы сверху — чуть меньше, чтобы на глаз весил как персонажи.
        <span className={cn("flex items-end justify-center", markClass)}>
          <BrandMark className="size-[86%]" />
        </span>
      ) : (
        <TeacherMark className={markClass} />
      )}
      <span className={cn("font-bold leading-none tracking-wide text-white/90", INITIALS_SIZE[size])}>
        {initialsOf(participant.fullName)}
      </span>
    </span>
  );
}

/*
 * Знаки-персонажи построены из знака «Матис»: диск с центральным вырезом —
 * плечи, «спутник» в верхней выемке — голова. Холст выше квадрата (325×420),
 * чтобы над головой поместился атрибут роли.
 */
function PersonBase({ maskId }: { maskId: string }) {
  return (
    <>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="325" height="420">
          <rect width="325" height="420" fill="#fff" />
          <circle cx="162.5" cy="257.5" r="66" fill="#000" />
          <circle cx="162.5" cy="106" r="54" fill="#000" />
        </mask>
      </defs>
      <circle cx="162.5" cy="257.5" r="162.5" fill="currentColor" mask={`url(#${maskId})`} />
      <circle cx="162.5" cy="106" r="40" fill="currentColor" />
    </>
  );
}

function useMaskId(prefix: string) {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function StudentMark({ className }: { className?: string }) {
  const maskId = useMaskId("student");
  return (
    <svg viewBox="0 0 325 420" className={cn("shrink-0", className)} focusable="false">
      <PersonBase maskId={maskId} />
      {/* Квадратная академическая шапочка с кисточкой. */}
      <path d="M162.5 4 L248 30 L162.5 56 L77 30 Z" fill="currentColor" />
      <path d="M126 38 L126 52 Q162.5 64 199 52 L199 38 L162.5 50 Z" fill="currentColor" />
      <path d="M162.5 30 L236 34 L236 60" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="236" cy="66" r="10" fill="currentColor" />
    </svg>
  );
}

function TeacherMark({ className }: { className?: string }) {
  const maskId = useMaskId("teacher");
  return (
    <svg viewBox="0 0 325 420" className={cn("shrink-0", className)} focusable="false">
      <PersonBase maskId={maskId} />
      {/* Галстук в вырезе-«вороте». */}
      <path d="M146 186 L179 186 L172 214 L153 214 Z" fill="currentColor" />
      <path d="M153 219 L172 219 L186 288 L162.5 312 L139 288 Z" fill="currentColor" />
    </svg>
  );
}
