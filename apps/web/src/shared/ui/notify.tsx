import { useEffect, type ReactNode } from "react";
import { Check, CircleAlert, Info, type LucideIcon } from "lucide-react";
import { toast as sonner } from "sonner";

import { cn } from "@/lib/utils";

/**
 * Единые уведомления (2026-10-17): одна белая карточка в правом верхнем углу,
 * всегда одного размера — иконка по центру левого края, заголовок, строка
 * пояснения, при необходимости кнопки справа. Тип не красит карточку: его
 * видно по иконке и тексту. Крестика нет — уведомления скрываются сами.
 *
 * На экране всегда одно уведомление: новое заменяет предыдущее, а не
 * копится стопкой. Состояния («Связь прервалась», «Просит войти») висят,
 * пока не пройдут: короткое сообщение их на время перекрывает, после него
 * состояние снова на месте. Устроено как тосты Контур Толка — у каждого
 * вида свой `id`: повтор не добавляет вторую карточку, а обновляет первую.
 * Показ, паузу таймера под курсором и смахивание даёт sonner (`<Toaster>`).
 */

export type NoticeAction = {
  label: string;
  onClick: () => void;
  /** Основная кнопка — синяя (единственный цвет на карточке); остальные — серые. */
  primary?: boolean;
  /** По умолчанию нажатие закрывает уведомление. */
  keepOpen?: boolean;
};

export type NoticeOptions = {
  /** Вид уведомления: второе с тем же `id` заменяет первое. */
  id?: string;
  icon?: LucideIcon;
  /** Что сделать или что это значит — одна короткая строка. */
  text?: ReactNode;
  /** Не больше двух коротких кнопок — карточка одного размера. */
  actions?: NoticeAction[];
  /** Мс; `Infinity` — состояние, пока его не снимут кодом. По умолчанию — по объёму (см. `durationOf`). */
  duration?: number;
};

/** Короткое — 4 с, с пояснением — 6 с, с кнопками — 8 с (успеть дотянуться). */
function durationOf(o: NoticeOptions): number {
  if (o.duration !== undefined) return o.duration;
  if (o.actions?.length) return 8_000;
  return o.text ? 6_000 : 4_000;
}

/** Уведомления на экране и среди них короткие: новое снимает короткие, состояния не трогает. */
const shown = new Set<string | number>();
const transient = new Set<string | number>();

function show(title: string, o: NoticeOptions = {}, fallbackIcon: LucideIcon = Info): string | number {
  const Icon = o.icon ?? fallbackIcon;
  const duration = durationOf(o);
  // Обновление уже показанного (тот же `id`) — не новое сообщение, остальных не снимает.
  if (o.id === undefined || !shown.has(o.id)) {
    for (const old of transient) if (old !== o.id) sonner.dismiss(old);
    transient.clear();
  }
  const forget = (t: { id: string | number }) => {
    shown.delete(t.id);
    transient.delete(t.id);
  };
  const id = sonner.custom(
    (toastId) => (
      <Notice
        icon={Icon}
        title={title}
        text={o.text}
        actions={o.actions}
        onAction={(a) => {
          a.onClick();
          if (!a.keepOpen) sonner.dismiss(toastId);
        }}
      />
    ),
    { id: o.id, duration, onDismiss: forget, onAutoClose: forget },
  );
  shown.add(id);
  if (Number.isFinite(duration)) transient.add(id);
  else transient.delete(id);
  return id;
}

export const notify = Object.assign((title: string, o?: NoticeOptions) => show(title, o), {
  info: (title: string, o?: NoticeOptions) => show(title, o, Info),
  success: (title: string, o?: NoticeOptions) => show(title, o, Check),
  error: (title: string, o?: NoticeOptions) => show(title, o, CircleAlert),
  dismiss: (id?: string | number) => void sonner.dismiss(id),
});

/** Карточка уведомления; отдельно — для макетов и тестов. */
export function Notice({
  icon: Icon,
  title,
  text,
  actions,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  text?: ReactNode;
  actions?: NoticeAction[];
  onAction?: (a: NoticeAction) => void;
}) {
  return (
    <div
      role="status"
      title={typeof text === "string" ? `${title}\n${text}` : title}
      className="flex h-16 w-full items-center gap-3 rounded-xl bg-card pl-4 pr-3 text-foreground shadow-[0_12px_32px_rgba(16,24,40,.18),0_2px_6px_rgba(16,24,40,.08)]"
    >
      <Icon className="size-6 shrink-0 text-text-2" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium leading-5", text ? "truncate" : "line-clamp-2 [overflow-wrap:anywhere]")}>
          {title}
        </p>
        {text ? <p className="truncate text-[13px] leading-5 text-text-2">{text}</p> : null}
      </div>
      {actions?.length ? (
        <div className="flex shrink-0 gap-2">
          {actions.slice(0, 2).map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => onAction?.(a)}
              className={cn(
                "h-8 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 [@media(pointer:coarse)]:h-10",
                a.primary
                  ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                  : "bg-secondary text-foreground hover:bg-surface-3",
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Отступ уведомления сверху, пока смонтирован экран (урок — под своей шапкой,
 * чтобы уведомление не закрывало кнопки «Пригласить» и «Настройки»).
 */
export function useNoticeOffset(top: number, mobileTop: number = top) {
  useEffect(() => {
    const s = document.documentElement.style;
    s.setProperty("--notice-top", `${top}px`);
    s.setProperty("--notice-top-mobile", `${mobileTop}px`);
    return () => {
      s.removeProperty("--notice-top");
      s.removeProperty("--notice-top-mobile");
    };
  }, [top, mobileTop]);
}
