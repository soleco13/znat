import { Logo } from "@/components/Logo";

const GROUPS = [
  {
    title: "Продукт",
    links: [
      { label: "Возможности", href: "#features" },
      { label: "Ход урока", href: "#lesson" },
      { label: "Движок заданий", href: "#tasks" },
      { label: "Тарифы", href: "#pricing" },
    ],
  },
  {
    title: "Ресурсы",
    links: [
      { label: "Как это работает", href: "#how" },
      { label: "Вопросы и ответы", href: "#faq" },
      { label: "Запросить демо", href: "#cta" },
      { label: "Статус сервиса", href: "#" },
    ],
  },
  {
    title: "Компания",
    links: [
      { label: "О платформе", href: "#" },
      { label: "Политика конфиденциальности", href: "#" },
      { label: "Обработка данных (152-ФЗ)", href: "#" },
      { label: "Контакты", href: "#" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="container-l py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-[13.5px] leading-relaxed text-muted-foreground">
              Платформа для онлайн-уроков: доска, слайды, материалы, задания, видео и запись —
              в одном пространстве. По подписке.
            </p>
            <div className="mt-5 flex gap-2">
              <a href="#pricing" className="rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-semibold text-foreground shadow-xs hover:bg-secondary">
                Начать бесплатно
              </a>
              <a href="/login" className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground">
                Войти
              </a>
            </div>
          </div>

          {GROUPS.map((g) => (
            <div key={g.title}>
              <h4 className="text-[12px] font-bold uppercase tracking-[0.08em] text-text-3">
                {g.title}
              </h4>
              <ul className="mt-3 space-y-2.5">
                {g.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      className="text-[13.5px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-[12.5px] text-text-3 sm:flex-row">
          <span>© {new Date().getFullYear()} «Матис». Все права защищены.</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-success" />
            Все системы работают
          </span>
        </div>
      </div>
    </footer>
  );
}
