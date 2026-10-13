import { ChevronUp, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";
import { Toggle } from "@/shared/ui/toggle";
import { SimpleTooltip } from "@/shared/ui/tooltip";
import { Loader } from "@/shared/ui/loader";
import { toast } from "@/shared/ui/sonner";

export type RoomControlVariant = "circle" | "bare" | "pill" | "tile" | "rail" | "menu";

/** Кнопки урока «парят» над затемнённым фоном — белые, с мягкой тенью вместо полос шапки и подвала. */
export const FLOATING_SHADOW = "shadow-[0_4px_14px_rgba(16,24,40,.08),0_1px_3px_rgba(16,24,40,.06)]";

/**
 * Кнопка панели урока. Три вида:
 *  - `circle` — круглый тумблер с подписью под кнопкой;
 *  - `bare` — тот же круг без подписи (тулбар окна «картинка в картинке»);
 *  - `pill` — десктопный футер: иконка + подпись в строку, опционально
 *    сплит-кнопка «шеврон» для выбора устройства внутри той же пилюли;
 *  - `tile` — мобильный футер: крупная плитка 56px, иконка над подписью;
 *  - `rail` — телефон в альбомной ориентации: квадрат 48px в колонке справа, только иконка;
 *  - `menu` — пункт выпадающего меню «Ещё» на телефоне: иконка и подпись в строку.
 * Выключенный микрофон или камера — та же белая кнопка с перечёркнутой иконкой
 * цвета текста (запрос 2026-10-13: красная заливка выглядела как «устройство
 * недоступно»). `tone` оставлен для совместимости: `media` и `quiet` теперь
 * выглядят одинаково. `tone="action"`: включено — синий тинт.
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
  hotkey,
}: {
  active: boolean;
  activeIcon: LucideIcon;
  inactiveIcon: LucideIcon;
  activeLabel: string;
  inactiveLabel: string;
  onToggle: () => void;
  disabled?: boolean;
  tone?: "media" | "quiet" | "action";
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
  /** Горячая клавиша (`RoomHotkeys` нажимает кнопку с этим `data-hotkey`) — и подсказка в тултипе. */
  hotkey?: string;
}) {
  const Icon = active ? ActiveIcon : InactiveIcon;
  const label = title ?? (active ? activeLabel : inactiveLabel);
  const highlighted = tone === "action" && active;
  const surface = highlighted
    ? "border-primary-muted bg-primary-light text-primary"
    : "border-border bg-card text-foreground";
  const hover = highlighted ? "hover:bg-black/[.04]" : "hover:bg-surface-2";
  const iconNode = loading ? <Loader /> : <Icon aria-hidden />;
  const tooltip = hotkey ? `${label} · ${hotkey}` : label;
  // Недоступна, но с причиной («Микрофон выключил учитель — поднимите руку»):
  // не блокируем, а по нажатию объясняем. У настоящей disabled-кнопки
  // подсказка не всплывает ни на телефоне, ни на десктопе (нет событий
  // указателя), и ученик видел просто серую кнопку, которая не жмётся.
  const explain = disabled && title ? title : null;
  const handleToggle = explain
    ? () => toast(explain, { position: "top-center", duration: 5000, id: "room-control-hint" })
    : onToggle;
  const blocked = disabled && !explain;

  if (variant === "menu") {
    return (
      <DropdownMenuItem
        onSelect={handleToggle}
        data-hotkey={hotkey}
        disabled={blocked}
        aria-disabled={explain ? true : undefined}
        aria-pressed={active}
        className={cn(
          "h-10 gap-2.5 rounded-md px-2.5 text-sm [&>svg]:size-[18px]",
          highlighted ? "text-primary [&>svg]:text-primary" : "[&>svg]:text-muted-foreground",
          explain && "opacity-50",
        )}
      >
        {iconNode}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge ? (
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
            {badge}
          </span>
        ) : null}
      </DropdownMenuItem>
    );
  }

  if (variant === "tile") {
    return (
      <button
        type="button"
        onClick={handleToggle}
        data-hotkey={hotkey}
        disabled={blocked}
        aria-disabled={explain ? true : undefined}
        aria-pressed={active}
        aria-label={label}
        title={label}
        className={cn(
          explain && "opacity-50",
          "relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-[3px] rounded-2xl border text-[11.5px] font-semibold leading-none transition-colors disabled:opacity-50 [&_svg]:size-[21px] [&_svg]:shrink-0",
          surface,
          hover,
          FLOATING_SHADOW,
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

  if (variant === "rail") {
    return (
      <button
        type="button"
        onClick={handleToggle}
        data-hotkey={hotkey}
        disabled={blocked}
        aria-disabled={explain ? true : undefined}
        aria-pressed={active}
        aria-label={label}
        title={label}
        className={cn(
          explain && "opacity-50",
          "relative flex size-12 shrink-0 items-center justify-center rounded-2xl border transition-colors disabled:opacity-50 [&_svg]:size-[21px] [&_svg]:shrink-0",
          surface,
          hover,
          FLOATING_SHADOW,
          speaking && "ring-2 ring-success ring-offset-1",
        )}
      >
        {iconNode}
        {badge ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
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
          "inline-flex shrink-0 items-center overflow-hidden rounded-full border transition-colors",
          FLOATING_SHADOW,
          surface,
          speaking && "ring-2 ring-success ring-offset-1",
        )}
      >
        <SimpleTooltip content={tooltip} side="top">
          <button
            type="button"
            onClick={handleToggle}
            data-hotkey={hotkey}
            disabled={blocked}
            aria-disabled={explain ? true : undefined}
            aria-pressed={active}
            aria-label={label}
            className={cn(
              explain && "opacity-50",
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
            <span aria-hidden className="h-[26px] w-px bg-border" />
            <SimpleTooltip content={settingsLabel} side="top">
              <button
                type="button"
                onClick={onOpenSettings}
                aria-label={settingsLabel}
                className="flex h-12 w-9 items-center justify-center text-text-3 transition-colors hover:bg-surface-2 hover:text-text-2 [&_svg]:size-4"
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
        <Toggle
          variant={tone === "media" ? "media" : "outline"}
          size="circle"
          pressed={active}
          onPressedChange={handleToggle}
          disabled={blocked}
          aria-disabled={explain ? true : undefined}
          aria-label={label}
          className={cn("relative size-11", FLOATING_SHADOW, explain && "opacity-50", speaking && "ring-2 ring-success ring-offset-1")}
        >
          {iconNode}
        </Toggle>
      </span>
    </SimpleTooltip>
  );
  if (!caption || variant === "bare") return button;
  return (
    <div className="flex flex-col items-center gap-1">
      {button}
      <span className="text-[11px] leading-none text-muted-foreground">{caption}</span>
    </div>
  );
}
