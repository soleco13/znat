import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Toggle } from "@/shared/ui/toggle";

/**
 * Э12.7 — кнопка нижней панели урока: круглый тумблер (shadcn `Toggle`,
 * вариант `media` — тот же, что на экране проверки устройств) + подпись
 * снизу. Состояние читается прямо с кнопки: включено — нейтральный вид и
 * иконка «есть», выключено — красный и иконка «нет», подпись меняется на
 * действие («Звук выкл.» = нажми, чтобы включить). `tone="action"` — для
 * кнопок-действий (демонстрация, рука), где «выключено» не значит «плохо».
 */
export function RoomControlButton({
  active,
  activeIcon: ActiveIcon,
  inactiveIcon: InactiveIcon,
  activeLabel,
  inactiveLabel,
  onToggle,
  disabled,
  title,
  tone = "media",
}: {
  active: boolean;
  activeIcon: LucideIcon;
  inactiveIcon: LucideIcon;
  /** Подпись, когда включено (обычно — название: «Микрофон»). */
  activeLabel: string;
  /** Подпись, когда выключено (обычно — действие: «Звук выкл.»). */
  inactiveLabel: string;
  onToggle: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "media" | "action";
}) {
  const Icon = active ? ActiveIcon : InactiveIcon;
  const label = active ? activeLabel : inactiveLabel;
  return (
    <div className="flex w-[4.75rem] shrink-0 flex-col items-center gap-1">
      <Toggle
        variant={tone === "media" ? "media" : "outline"}
        size="circle"
        pressed={active}
        onPressedChange={onToggle}
        disabled={disabled}
        aria-label={label}
        title={title ?? label}
      >
        <Icon aria-hidden />
      </Toggle>
      <span
        className={cn(
          "w-full truncate text-center text-[11px] font-medium leading-none",
          tone === "media" && !active ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}
