import { Toaster as Sonner } from "sonner";

/**
 * Место уведомлений (`notify`, см. `notify.tsx`): всегда правый верхний
 * угол и всегда одно — новое заменяет предыдущее. Отступ сверху экран
 * задаёт через `useNoticeOffset` (урок — под шапкой). Карточку рисует `Notice`.
 */
export function Toaster() {
  return (
    <Sonner
      position="top-right"
      visibleToasts={1}
      expand={false}
      offset={{ top: "var(--notice-top, 16px)", right: 14 }}
      mobileOffset={{ top: "var(--notice-top-mobile, 12px)", left: 12, right: 12 }}
      toastOptions={{ unstyled: true, className: "w-[var(--width)]" }}
      style={{ "--width": "420px" } as React.CSSProperties}
      containerAriaLabel="Уведомления"
    />
  );
}
