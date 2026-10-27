import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Layout } from "@/site/Layout";
import { SUPPORT_EMAIL, SUPPORT_TELEGRAM, SUPPORT_TELEGRAM_URL } from "@/lib/contacts";

/**
 * Формы на сайте нет: у приложения нет приёма заявок, а показывать «отправлено»
 * без настоящей отправки нельзя. Запрос демонстрации — письмо с готовой темой
 * и шаблоном (открывается почтовая программа посетителя) или сообщение в Telegram.
 */
const DEMO_SUBJECT = "Демонстрация Матиса для школы";
const DEMO_BODY = [
  "Здравствуйте!",
  "",
  "Хотим посмотреть Матис для нашей школы.",
  "",
  "Школа:",
  "Сколько учителей и учеников:",
  "Предметы:",
  "Как сейчас проводите уроки:",
  "Удобное время для созвона:",
].join("\n");
const DEMO_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(DEMO_SUBJECT)}&body=${encodeURIComponent(DEMO_BODY)}`;

const CHANNELS = [
  {
    name: "Telegram",
    value: SUPPORT_TELEGRAM,
    href: SUPPORT_TELEGRAM_URL,
    external: true,
    who: "Репетиторам и школам: работа платформы, тарифы, оплата и возврат.",
  },
  {
    name: "Почта",
    value: SUPPORT_EMAIL,
    href: `mailto:${SUPPORT_EMAIL}`,
    external: false,
    who: "Школам и организациям: подключение, договор, перенос материалов.",
  },
];

export function ContactsPage() {
  return (
    <Layout page="contacts">
      <section className="pb-12 pt-12 sm:pt-20">
        <div className="container-l">
          <h1 className="text-h2 text-foreground">Контакты</h1>
          <p className="mt-5 max-w-[48ch] text-body text-text-2 sm:text-lead">
            Отвечаем в Telegram и на почту. Напишите, если что‑то не работает, есть вопрос по оплате или хотите подключить школу.
          </p>
        </div>
      </section>

      <section aria-label="Способы связи" className="pb-16">
        <div className="container-l">
          <ul className="border-t border-foreground">
            {CHANNELS.map((c) => (
              <li key={c.name} className="grid gap-2 border-b border-border py-8 md:grid-cols-[minmax(0,0.5fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-baseline md:gap-10">
                <h2 className="text-small font-semibold text-text-3">{c.name}</h2>
                <a
                  href={c.href}
                  {...(c.external ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="group inline-flex items-center gap-1.5 justify-self-start break-all text-[clamp(1.5rem,1.1rem+1.6vw,2.25rem)] font-bold leading-tight tracking-[-0.025em] text-foreground underline decoration-transparent decoration-2 underline-offset-[6px] transition-colors duration-150 hover:decoration-primary"
                >
                  {c.value}
                  {c.external ? (
                    <>
                      <ArrowUpRight className="size-6 shrink-0 text-text-3 transition-colors group-hover:text-primary" aria-hidden />
                      <span className="sr-only">(откроется в новой вкладке)</span>
                    </>
                  ) : null}
                </a>
                <p className="text-small text-text-2">{c.who}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="demo" aria-labelledby="demo-title" className="scroll-mt-24 border-t border-border bg-card py-16 sm:py-24">
        <div className="container-l grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
          <div>
            <h2 id="demo-title" className="text-h2 text-foreground">
              Демонстрация для школы
            </h2>
            <p className="mt-5 max-w-[46ch] text-body text-text-2">
              Проведём урок в Матисе на ваших материалах: покажем доску, задания и запись, ответим про тарифы и
              перенос.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
              <a href={DEMO_MAILTO} className={buttonVariants({ size: "cta" })}>
                Написать письмо
              </a>
              <a
                href={SUPPORT_TELEGRAM_URL}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "quiet", size: "cta" }), "self-start px-0 sm:self-auto")}
              >
                Написать в Telegram
              </a>
            </div>
            <p className="mt-4 text-caption text-text-3">Письмо откроется в вашей почтовой программе с готовым шаблоном.</p>
          </div>

          <div>
            <h3 className="text-small font-semibold text-text-3">Что написать, чтобы мы подготовились</h3>
            <ul className="mt-4 divide-y divide-border border-y border-border text-body text-foreground">
              <li className="py-3">Название школы и сайт</li>
              <li className="py-3">Сколько учителей и учеников</li>
              <li className="py-3">Предметы и формат: группы или индивидуально</li>
              <li className="py-3">Чем пользуетесь сейчас</li>
              <li className="py-3">Удобное время для созвона</li>
            </ul>
          </div>
        </div>
      </section>

    </Layout>
  );
}
