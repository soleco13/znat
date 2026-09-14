import { Loader2, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Toggle } from "@/shared/ui/toggle";
import { SimpleTooltip } from "@/shared/ui/tooltip";

/**
 * Э12.7 — кнопка нижней панели урока: круглый тумблер (shadcn `Toggle`,
 * вариант `media` — как на экране проверки устройств). Только иконка,
 * подпись — во всплывающей подсказке. Состояние читается прямо с кнопки:
 * включено — нейтральный вид и иконка «есть», выключено — красный и иконка
 * «нет». `tone="action"` — для кнопок-действий (демонстрация, рука), где
 * «выключено» не значит «плохо». `speaking` — зелёное кольцо, когда идёт
 * сигнал с микрофона (человек говорит).
 */
export function RoomControlButton({
  active,
  activeIcon: ActiveIcon,
  inactiveIcon: InactiveIcon,
  activeLabel,
  inactiveLabel,
  onToggle,
  disabled,
  tone = "media",
  speaking = false,
  loading = false,
  title,
  caption,
}: {
  active: boolean;
  activeIcon: LucideIcon;
  inactiveIcon: LucideIcon;
  /** Подпись-подсказка, когда включено (обычно название: «Микрофон»). */
  activeLabel: string;
  /** Подпись-подсказка, когда выключено (обычно действие: «Включить звук»). */
  inactiveLabel: string;
  onToggle: () => void;
  disabled?: boolean;
  tone?: "media" | "action";
  speaking?: boolean;
  /** Идёт получение устройства/потока (напр. камера ещё грузится после клика) — иконка сменяется на спиннер, но кнопка остаётся кликабельной. */
  loading?: boolean;
  /** Переопределяет текст подсказки (напр. причину, по которой кнопка недоступна). */
  title?: string;
  /** Короткая постоянная подпись под кнопкой (не зависит от состояния — само состояние видно на кнопке). */
  caption?: string;
}) {
  const Icon = active ? ActiveIcon : InactiveIcon;
  const label = title ?? (active ? activeLabel : inactiveLabel);
  const button = (
    <SimpleTooltip content={label} side="top">
      <span className="relative inline-flex">
        {speaking ? (
          <span className="absolute inset-0 animate-ping rounded-full bg-success/40" aria-hidden />
        ) : null}
        <Toggle
          variant={tone === "media" ? "media" : "outline"}
          size="circle"
          pressed={active}
          onPressedChange={onToggle}
          disabled={disabled}
          aria-label={label}
          // Тач-таргет крупнее дефолтных 40px (size-10) — телефон/планшет,
          // не только мышь.
          className={cn("relative size-11", speaking && "ring-2 ring-success ring-offset-1")}
        >
          {loading ? <Loader2 className="animate-spin" aria-hidden /> : <Icon aria-hidden />}
        </Toggle>
      </span>
    </SimpleTooltip>
  );
  if (!caption) return button;
  return (
    <div className="flex flex-col items-center gap-1">
      {button}
      <span className="text-[11px] leading-none text-muted-foreground">{caption}</span>
    </div>
  );
}
