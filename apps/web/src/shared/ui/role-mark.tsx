import { useId, type CSSProperties } from "react";

/**
 * Цвет участника — пара «фон / знак» из спокойных оттенков фирменных синего,
 * бирюзового и сланцевого: тёмные (--c-primary-hover, --c-teal и их ступени,
 * --c-text-2) с белым знаком и пастельные (--c-primary-light,
 * --c-primary-muted, --c-teal-light, --c-surface-3) со знаком в тон. Цвет
 * закреплён за id: у человека он одинаков везде — в плитке урока, списке
 * участников, шапке.
 */
const TINTS: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: "#1e40af", fg: "#ffffff" },
  { bg: "#eff4ff", fg: "#1d4ed8" },
  { bg: "#0f766e", fg: "#ffffff" },
  { bg: "#effcf9", fg: "#0d9488" },
  { bg: "#1e3a8a", fg: "#ffffff" },
  { bg: "#c7d7fe", fg: "#1e40af" },
  { bg: "#475467", fg: "#ffffff" },
  { bg: "#ccefe9", fg: "#0f766e" },
  { bg: "#115e59", fg: "#ffffff" },
  { bg: "#f0f2f5", fg: "#475467" },
];

export function tintOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return TINTS[Math.abs(h) % TINTS.length]!;
}

export type MarkRole = "student" | "teacher" | "admin";

/** Ученик — гость урока; методист показывается как учитель. */
export function markRoleOf(kind: "staff" | "guest", role: string | null | undefined): MarkRole {
  if (kind === "guest") return "student";
  return role === "admin" ? "admin" : "teacher";
}

/** Шапочка ученика добавляет холст сверху; диск при этом того же размера. */
export const MARK_TOP: Record<MarkRole, number> = { student: -86, teacher: 0, admin: 0 };

/**
 * Знак «Матис» по роли. Основа — знак из фавикона
 * (docs/brand/logo/06-favicon.svg): диск, центральный вырез, «спутник»,
 * прорезающий верхний край. Ученику над выемкой добавлена академическая
 * шапочка, учителю — галстук в вырезе, у администратора — обычный знак.
 * Цвет — `currentColor`. `disc` — высота диска в px (общая высота с
 * шапочкой больше); `fit` — предел общей высоты, например `80%` от родителя.
 */
export function RoleMark({ role, disc, fit }: { role: MarkRole; disc: number; fit?: string }) {
  const maskId = `mark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const top = MARK_TOP[role];
  const full = Math.round((disc * (325 - top)) / 325);
  const style: CSSProperties = {
    height: fit ? `min(${full}px, ${fit})` : full,
    aspectRatio: `325 / ${325 - top}`,
  };
  return (
    <svg
      viewBox={`0 ${top} 325 ${325 - top}`}
      className="shrink-0"
      style={style}
      aria-hidden
      focusable="false"
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="325" height="325">
          <rect width="325" height="325" fill="#fff" />
          <circle cx="162.5" cy="162.5" r="72" fill="#000" />
          <circle cx="162.5" cy="14" r="44" fill="#000" />
        </mask>
      </defs>
      <circle cx="162.5" cy="162.5" r="162.5" fill="currentColor" mask={`url(#${maskId})`} />
      {role === "student" ? (
        <>
          <path d="M162.5 -84 L254 -54 L162.5 -24 L71 -54 Z" fill="currentColor" />
          <path d="M122 -44 L122 -26 Q162.5 -12 203 -26 L203 -44 L162.5 -30 Z" fill="currentColor" />
          <path
            d="M162.5 -54 L242 -50 L242 -18"
            fill="none"
            stroke="currentColor"
            strokeWidth="9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="242" cy="-12" r="11" fill="currentColor" />
        </>
      ) : role === "teacher" ? (
        <>
          <path d="M145 86 L180 86 L173 114 L152 114 Z" fill="currentColor" />
          <path d="M152 119 L173 119 L188 192 L162.5 218 L137 192 Z" fill="currentColor" />
        </>
      ) : null}
    </svg>
  );
}
