import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { APP, PAGES, type PageId } from "@/lib/site";
import { SUPPORT_EMAIL, SUPPORT_TELEGRAM, SUPPORT_TELEGRAM_URL } from "@/lib/contacts";

/** Общая рамка трёх страниц: шапка, `<main>`, подвал. */
export function Layout({ page, children }: { page: PageId; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a href="#main" className="skip-link">
        К содержимому
      </a>
      <Header page={page} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}

function Header({ page }: { page: PageId }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Меню на телефоне: Esc закрывает и возвращает фокус на кнопку; на широком экране меню не нужно.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    const mq = window.matchMedia("(min-width: 768px)");
    const onWide = () => mq.matches && setOpen(false);
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onWide);
    };
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b bg-background transition-colors duration-200",
        scrolled || open ? "border-border" : "border-transparent",
      )}
    >
      <div className="container-l flex h-16 items-center gap-8">
        <a href="/" aria-label="Матис — на главную" className="-m-1 shrink-0 rounded-md p-1">
          <Logo />
        </a>

        <nav aria-label="Основное" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {PAGES.map((p) => (
              <li key={p.id}>
                <a
                  href={p.href}
                  aria-current={p.id === page ? "page" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center rounded-md px-3 text-small font-semibold transition-colors duration-150",
                    p.id === page ? "text-foreground" : "text-text-2 hover:text-foreground",
                  )}
                >
                  <span className={cn("border-b-2 py-0.5", p.id === page ? "border-primary" : "border-transparent")}>
                    {p.label}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <a href={APP.login} className={cn(buttonVariants({ variant: "ghost" }), "hidden sm:inline-flex")}>
            Войти
          </a>
          <a href={APP.register} className={buttonVariants()}>
            <span>
              Начать<span className="hidden sm:inline"> бесплатно</span>
            </span>
          </a>
          <button
            ref={toggle}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "Закрыть меню" : "Открыть меню"}
            className="-mr-2 grid size-11 cursor-pointer place-items-center rounded-md text-text-2 transition-colors duration-150 hover:bg-secondary md:hidden"
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>

      {open ? (
        <nav id="site-menu" aria-label="Основное" className="fade-in border-t border-border md:hidden">
          <ul className="container-l py-2">
            {PAGES.map((p) => (
              <li key={p.id}>
                <a
                  href={p.href}
                  aria-current={p.id === page ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 items-center justify-between border-b border-border text-body font-semibold",
                    p.id === page ? "text-foreground" : "text-text-2",
                  )}
                >
                  {p.label}
                  {p.id === page ? <span className="size-1.5 rounded-full bg-primary" aria-hidden /> : null}
                </a>
              </li>
            ))}
            <li>
              <a href={APP.login} className="flex min-h-12 items-center text-body font-semibold text-text-2">
                Войти
              </a>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}

const FOOTER_LINKS = [
  {
    title: "Сайт",
    links: PAGES.map((p) => ({ label: p.label, href: p.href })),
  },
  {
    title: "Документы",
    links: [
      { label: "Пользовательское соглашение", href: APP.terms },
      { label: "Политика конфиденциальности", href: APP.privacy },
      { label: "Согласие на обработку данных", href: APP.consent },
      { label: "Реквизиты", href: APP.requisites },
    ],
  },
];

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="container-l grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1.2fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-[32ch] text-small text-muted-foreground">
            Платформа для онлайн-уроков репетиторов и школ.
          </p>
        </div>

        {FOOTER_LINKS.map((g) => (
          <div key={g.title}>
            <h2 className="text-caption font-semibold text-text-3">{g.title}</h2>
            <ul className="mt-3 space-y-2">
              {g.links.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="text-small text-text-2 transition-colors duration-150 hover:text-foreground">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div>
          <h2 className="text-caption font-semibold text-text-3">Связь</h2>
          <ul className="mt-3 space-y-2">
            <li>
              <a href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noreferrer" className="text-small text-text-2 transition-colors duration-150 hover:text-foreground">
                Telegram {SUPPORT_TELEGRAM}
              </a>
            </li>
            <li>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-small text-text-2 transition-colors duration-150 hover:text-foreground">
                {SUPPORT_EMAIL}
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="container-l">
        <p className="border-t border-border py-6 text-caption text-text-3">
          © {new Date().getFullYear()} «Матис». ИП Скрипак А. С., ИНН 226702096920, ОГРНИП 326220200038927.
        </p>
      </div>
    </footer>
  );
}
