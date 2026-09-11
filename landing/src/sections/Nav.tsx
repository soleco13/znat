import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";

const LINKS = [
  { href: "#features", label: "Возможности" },
  { href: "#canvas", label: "Холст урока" },
  { href: "#how", label: "Как это работает" },
  { href: "#pricing", label: "Тарифы" },
  { href: "#faq", label: "Вопросы" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300 ease-ds",
        scrolled ? "py-2.5" : "py-4",
      )}
    >
      <div className="container-l">
        <nav
          className={cn(
            "flex items-center justify-between gap-4 rounded-pill px-3 py-2 transition-all duration-300 ease-ds sm:px-4",
            scrolled
              ? "glass border border-border/70 shadow-md"
              : "border border-transparent",
          )}
        >
          <a href="#top" className="shrink-0 rounded-pill py-1 pl-1.5 pr-2" aria-label="Школа онлайн — на главную">
            <Logo />
          </a>

          <div className="hidden items-center gap-1 lg:flex">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-pill px-3.5 py-2 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <Button asChild variant="ghost" size="sm">
              <a href="#login">Войти</a>
            </Button>
            <Button asChild size="sm">
              <a href="#pricing">Начать бесплатно</a>
            </Button>
          </div>

          <button
            type="button"
            className="grid size-9 place-items-center rounded-full text-foreground sm:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={open}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </nav>

        {open ? (
          <div className="mt-2 grid gap-1 rounded-2xl border border-border bg-card p-3 shadow-lg sm:hidden">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-[15px] font-medium text-foreground hover:bg-secondary"
              >
                {l.label}
              </a>
            ))}
            <div className="mt-1 grid grid-cols-2 gap-2 border-t border-border pt-3">
              <Button asChild variant="secondary" size="sm">
                <a href="#login">Войти</a>
              </Button>
              <Button asChild size="sm">
                <a href="#pricing">Начать</a>
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
