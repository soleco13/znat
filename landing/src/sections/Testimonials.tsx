import { ChatMsg } from "@/components/ChatMsg";
import { SectionHeading } from "@/components/SectionHeading";
import { UserAvatar } from "@/lesson/parts";

const ITEMS = [
  {
    quote:
      "Раньше у нас было три сервиса и инструкция для родителей на страницу. Теперь ученику приходит одна ссылка, и он в классе за десять секунд.",
    name: "Ирина К.",
    role: "Руководитель онлайн-школы",
    at: "10:12",
  },
  {
    quote:
      "Редактор материалов — то, ради чего мы перешли. Методисты собирают проверочные сами, без программиста, а баллы платформа считает сама.",
    name: "Дмитрий С.",
    role: "Методист по математике",
    at: "10:14",
  },
  {
    quote:
      "Доска и слайды в одном холсте изменили сам формат урока. Дети пишут у доски по очереди, я вижу, кто отвечает — не гадаю по чёрному экрану.",
    name: "Марина В.",
    role: "Учитель русского языка",
    at: "10:15",
  },
];

/** Отзывы — сообщения в чате урока (та же разметка, что у чата в комнате). */
export function Testimonials() {
  return (
    <section className="relative border-t border-border bg-white py-24 sm:py-32">
      <div className="container-l grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
        <SectionHeading title="Что пишут в чат после урока" />

        <div className="lesson-ui flex flex-col gap-7">
          {ITEMS.map((t) => (
            <div key={t.name} className="flex gap-3.5">
              <UserAvatar name={t.name} size={40} />
              <ChatMsg
                className="min-w-0"
                typingMs={900}
                header={
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[15px] font-semibold text-foreground">{t.name}</span>
                    <span className="text-[12.5px] text-text-3">{t.role}</span>
                    <span className="text-[12px] text-text-3">{t.at}</span>
                  </span>
                }
              >
                <span className="block max-w-[58ch] rounded-md bg-surface-2 px-4 py-3 text-body text-foreground">
                  {t.quote}
                </span>
              </ChatMsg>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
