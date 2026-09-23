import { ChevronUp, Loader2, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Toggle } from "@/shared/ui/toggle";
import { SimpleTooltip } from "@/shared/ui/tooltip";

export type RoomControlVariant = "circle" | "pill" | "tile";

/**
 * Кнопка панели урока. Три вида:
 *  - `circle` — круглый тумблер с подписью в тултипе (PiP-тулбар);
 *  - `pill` — десктопный футер: иконка + подпись в строку, опционально
 *    сплит-кнопка «шеврон» для выбора устройства внутри той же пилюли;
 *  - `tile` — мобильный футер: крупная плитка 56px, иконка над подписью.
 * `tone="media"`: выключено — красная заливка. `tone="action"`: включено — синий тинт.
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
  variant = "circle",
  onOpenSettings,
  settingsLabel = "Настройки устройства",
  badge,
}: {
  active: boolean;
  activeIcon: LucideIcon;
  inactiveIcon: LucideIcon;
  activeLabel: string;
  inactiveLabel: string;
  onToggle: () => void;
  disabled?: boolean;
  tone?: "media" | "action";
  speaking?: boolean;
  loading?: boolean;
  /** Переопределяет текст подсказки (напр. причину, по которой кнопка недоступна). */
  title?: string;
  /** Короткая постоянная подпись: под кнопкой у `circle`, внутри плитки у `tile`. */
  caption?: string;
  variant?: RoomControlVariant;
  /** Только `pill`: шеврон выбора устройства в той же пилюле. */
  onOpenSettings?: () => void;
  settingsLabel?: string;
  /** Только `tile`: счётчик в углу (непрочитанные сообщения). */
  badge?: number;
}) {
  const Icon = active ? ActiveIcon : InactiveIcon;
  const label = title ?? (active ? activeLabel : inactiveLabel);
  const alarm = tone === "media" && !active;
  const highlighted = tone === "action" && active;
  const surface = alarm
    ? "border-destructive bg-destructive text-destructive-foreground"
    : highlighted
      ? "border-primary-muted bg-primary-light text-primary"
      : "border-border bg-card text-foreground";
  const hover = alarm ? "hover:bg-black/10" : highlighted ? "hover:bg-black/[.04]" : "hover:bg-surface-2";
  const iconNode = loading ? <Loader2 className="animate-spin" aria-hidden /> : <Icon aria-hidden />;

  if (variant === "tile") {
    return (
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={active}
        aria-label={label}
        title={label}
        className={cn(
          "relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-[3px] rounded-2xl border text-[11.5px] font-semibold leading-none transition-colors disabled:opacity-50 [&_svg]:size-[21px] [&_svg]:shrink-0",
          surface,
          alarm ? "" : hover,
          speaking && "ring-2 ring-success ring-offset-1",
        )}
      >
        {iconNode}
        <span className="max-w-full truncate px-1">{caption ?? label}</span>
        {badge ? (
          <span className="absolute right-2.5 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
            {badge}
          </span>
        ) : null}
      </button>
    );
  }

  if (variant === "pill") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center overflow-hidden rounded-full border shadow-xs transition-colors",
          surface,
          speaking && "ring-2 ring-success ring-offset-1",
        )}
      >
        <SimpleTooltip content={label} side="top">
          <button
            type="button"
            onClick={onToggle}
            disabled={disabled}
            aria-pressed={active}
            aria-label={label}
            className={cn(
              "inline-flex h-12 items-center gap-2 px-3.5 text-[15px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 lg:px-[18px] [&_svg]:size-5 [&_svg]:shrink-0",
              hover,
            )}
          >
            {iconNode}
            {/* Подпись — только от `xl` (1280px). Планшет в альбомной
                ориентации (~1024–1180px) уже попадает в `lg`, но там же
                справа панель участников (340px, с `md`) — вместе с
                подписями кнопки переставали помещаться и наезжали друг на
                друга (жалоба пользователя, 2026-09-23). Без подписи кнопки
                компактнее, тултип на hover/long-press всё равно называет
                каждую.
                `caption ?? label`, а не всегда `label` — у мик/камеры/
                демонстрации `activeLabel`/`inactiveLabel` разной длины
                («Включить камеру» ⇄ «Камера»), кнопка пилюлей меняла
                ширину при каждом клике и «прыгала» в ряду соседних кнопок
                (жалоба пользователя, 2026-09-23). `caption` — короткий
                неизменный текст (уже используется в `tile`-варианте на
                телефоне), aria-label и подсказка остаются динамическими —
                состояние всё равно озвучено/показано во всплывающей
                подсказке и цветом/иконкой самой кнопки. */}
            <span className="hidden whitespace-nowrap xl:inline">{caption ?? label}</span>
          </button>
        </SimpleTooltip>
        {onOpenSettings ? (
          <>
            <span aria-hidden className={cn("h-[26px] w-px", alarm ? "bg-white/30" : "bg-border")} />
            <SimpleTooltip content={settingsLabel} side="top">
              <button
                type="button"
                onClick={onOpenSettings}
                aria-label={settingsLabel}
                className={cn(
                  "flex h-12 w-9 items-center justify-center transition-colors [&_svg]:size-4",
                  alarm ? "text-white/80 hover:bg-black/10" : "text-text-3 hover:bg-surface-2 hover:text-text-2",
                )}
              >
                <ChevronUp aria-hidden />
              </button>
            </SimpleTooltip>
          </>
        ) : null}
      </span>
    );
  }

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
          className={cn("relative size-11", speaking && "ring-2 ring-success ring-offset-1")}
        >
          {iconNode}
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
