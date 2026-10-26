import { Logo } from "@/components/Logo";
import { buttonVariants } from "@/components/ui/button";
import { SUPPORT_EMAIL, SUPPORT_TELEGRAM, SUPPORT_TELEGRAM_URL } from "@/lib/contacts";

const GROUPS = [
  {
    title: "Продукт",
    links: [
      { label: "Возможности", href: "#features" },
      { label: "Ход урока", href: "#lesson" },
      { label: "Задания", href: "#tasks" },
      { label: "Тарифы", href: "#pricing" },
    ],
  },
  {
    title: "Ресурсы",
    links: [
      { label: "Как это работает", href: "#how" },
      { label: "Вопросы и ответы", href: "#faq" },
      { label: "Запросить демо", href: "#cta" },
      { label: "Кому подойдёт", href: "#audience" },
    ],
  },
  {
    title: "Компания",
    links: [
      { label: "Пользовательское соглашение", href: "/terms" },
      { label: "Политика конфиденциальности", href: "/privacy" },
      { label: "Согласие на обработку данных", href: "/consent" },
      { label: "Реквизиты и контакты", href: "/requisites" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="container-l py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.2fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-muted-foreground">
              Платформа для онлайн-уроков: доска, слайды, материалы, задания, видео и запись —
              в одном пространстве. По подписке.
            </p>
            <div className="mt-5 flex gap-2">
              <a href="#pricing" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Начать бесплатно
              </a>
              <a href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Войти
              </a>
            </div>
          </div>

          {GROUPS.map((g) => (
            <div key={g.title}>
              <h4 className="text-[14px] font-semibold text-foreground">
                {g.title}
              </h4>
              <ul className="mt-3 space-y-2.5">
                {g.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      className="text-[14px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h4 className="text-[14px] font-semibold text-foreground">Поддержка</h4>
            <ul className="mt-3 space-y-3.5">
              <li>
                <a
                  href={SUPPORT_TELEGRAM_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[14px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Telegram {SUPPORT_TELEGRAM}
                </a>
                <p className="mt-0.5 text-caption text-text-3">Школам и репетиторам</p>
              </li>
              <li>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="text-[14px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {SUPPORT_EMAIL}
                </a>
                <p className="mt-0.5 text-caption text-text-3">Школам и организациям</p>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-6 text-caption text-text-3">
          © {new Date().getFullYear()} «Матис». ИП Скрипак А. С., ИНН 226702096920, ОГРНИП 326220200038927.
        </div>
      </div>
    </footer>
  );
}
