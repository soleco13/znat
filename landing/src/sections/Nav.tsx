import { useEffect, useRef, useState } from "react";
import { GraduationCap, Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export const SECTIONS = [
  { id: "audience", label: "Для кого" },
  { id: "features", label: "Возможности" },
  { id: "lesson", label: "Ход урока" },
  { id: "tasks", label: "Задания" },
  { id: "pricing", label: "Тарифы" },
  { id: "faq", label: "Вопросы" },
];

function useActiveSection() {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const els = SECTIONS.map((l) => document.getElementById(l.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
          else setActive((cur) => (cur === e.target.id ? null : cur));
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return active;
}

/** Шапка страницы — по разметке шапки урока (RoomPage → header). При скролле — сплошной фон и линия, без стекла. */
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300",
        scrolled || open ? "border-border bg-card" : "border-transparent bg-transparent",
      )}
    >
      <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
        <a href="#top" className="flex min-w-0 items-center gap-3" aria-label="Матис — на главную">
          <span className="flex size-[30px] shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <GraduationCap className="size-[17px]" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[15px] font-bold leading-tight tracking-[-.02em]">Матис</span>
            <span className="hidden truncate text-xs leading-tight text-muted-foreground sm:block">
              Знакомство с платформой
            </span>
          </span>
        </a>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <a
            href="/login"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:inline-flex")}
          >
            Войти
          </a>
          <a
            href="#pricing"
            className={buttonVariants({ size: "sm" })}
          >
            <span>
              Начать<span className="hidden sm:inline"> бесплатно</span>
            </span>
          </a>
          <button
            type="button"
            className="grid size-11 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-3 md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={open}
          >
            {open ? <X className="size-[18px]" /> : <Menu className="size-[18px]" />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="fade-in grid gap-1 px-3 pb-4 md:hidden">
          {SECTIONS.map((l) => (
            <a
              key={l.id}
              href={`#${l.id}`}
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-3 text-body font-semibold text-foreground active:bg-surface-3"
            >
              {l.label}
            </a>
          ))}
          <a href="/login" className="rounded-md px-3 py-3 text-body font-semibold text-muted-foreground">
            Войти
          </a>
        </div>
      ) : null}
    </header>
  );
}

/**
 * Навигация по разделам — панель управления урока внизу экрана: те же пилюли
 * (`RoomControlButton variant="pill"`). Подсветка активного раздела «переезжает»
 * между пунктами (clip-path на дублирующем слое — без анимации размеров).
 */
export function Dock() {
  const active = useActiveSection();
  const [show, setShow] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const items = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [box, setBox] = useState<{ l: number; r: number; t: number; b: number } | null>(null);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 520);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const measure = () => {
      const w = wrap.current;
      const el = active ? items.current[active] : null;
      if (!w || !el) return setBox(null);
      setBox({
        l: el.offsetLeft,
        r: w.offsetWidth - el.offsetLeft - el.offsetWidth,
        t: el.offsetTop,
        b: w.offsetHeight - el.offsetTop - el.offsetHeight,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active, show]);

  const hidden = !show || active === "lesson";
  const vars = box
    ? ({ ["--l" as string]: `${box.l}px`, ["--r" as string]: `${box.r}px`, ["--t" as string]: `${box.t}px`, ["--b" as string]: `${box.b}px` } as React.CSSProperties)
    : ({ ["--l" as string]: "50%", ["--r" as string]: "50%", ["--t" as string]: "50%", ["--b" as string]: "50%" } as React.CSSProperties);

  return (
    <nav
      aria-label="Разделы"
      aria-hidden={hidden}
      className={cn(
        "fixed inset-x-0 bottom-4 z-40 hidden justify-center transition-[transform,opacity] duration-500 ease-ds md:flex",
        hidden ? "pointer-events-none translate-y-6 opacity-0" : "translate-y-0 opacity-100",
      )}
    >
      <div ref={wrap} className="relative rounded-full border border-border bg-card shadow-md">
        <div className="flex items-center gap-1.5 p-1.5">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              ref={(el) => {
                items.current[s.id] = el;
              }}
              href={`#${s.id}`}
              tabIndex={hidden ? -1 : 0}
              aria-current={active === s.id ? "true" : undefined}
              className="inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-[14px] font-semibold text-text-2 transition-colors duration-200 hover:text-foreground focus-visible:outline-2"
            >
              {s.label}
            </a>
          ))}
        </div>
        <div
          aria-hidden
          className="dock-hl pointer-events-none absolute inset-0 rounded-full border border-primary-muted bg-primary-light"
          style={vars}
        >
          <div className="flex items-center gap-1.5 p-1.5">
            {SECTIONS.map((s) => (
              <span key={s.id} className="inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-[14px] font-semibold text-primary">
                {s.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
