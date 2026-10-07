import type { ParticipantSnapshot } from "@school/shared";

import { cn } from "@/lib/utils";
import { markRoleOf, RoleMark, tintOf } from "@/shared/ui/role-mark";

type Size = "lg" | "md" | "sm" | "xs";

/** Высота диска знака в px — не больше; на низких плитках знак ужимается по месту. */
const DISC_PX: Record<Size, number> = { lg: 134, md: 90, sm: 48, xs: 56 };
/**
 * Поля сверху и снизу под метки плитки («говорит», рука) и подпись с именем —
 * знак центрируется между ними и не налезает (телефон в альбомной ориентации).
 * У `xs` подписи нет.
 */
const PAD: Record<Size, string> = { lg: "py-9", md: "py-8", sm: "py-7", xs: "py-2" };

/** Плитка участника с выключенной камерой: его цвет и знак «Матис» по роли. */
export function ParticipantPlaceholder({
  participant,
  colorKey,
  size,
}: {
  participant: Pick<ParticipantSnapshot, "kind" | "role">;
  /** `participantColorKey` — цвет не меняется после повторного входа гостя. */
  colorKey: string;
  size: Size;
}) {
  const tint = tintOf(colorKey);
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-0 flex items-center justify-center rounded-[inherit] shadow-[inset_0_0_0_1px_rgba(16,24,40,.06)]",
        PAD[size],
      )}
      style={{ backgroundColor: tint.bg, color: tint.fg }}
      aria-hidden
    >
      <RoleMark
        role={markRoleOf(participant.kind, participant.role)}
        disc={DISC_PX[size]}
        fit="85%"
      />
    </span>
  );
}
