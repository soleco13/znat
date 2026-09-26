import { ChatMsg } from "@/components/ChatMsg";
import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";

const MESSAGES = [
  {
    who: "Марина Петровна",
    at: "09:52",
    body: "Создала урок «Алгебра · 8 класс». Ссылка постоянная — отправляю один раз на весь курс."
  },
  {
    who: "Марина Петровна",
    at: "09:53",
    body: "Ссылка на весь класс: matis.online/j/8k2-xq",
    cont: true,
  },
  { who: "Аня Соколова", at: "09:58", body: "Открыла, ввела имя. Камера и микрофон проверены." },
  { who: "Илья Крылов", at: "09:58", body: "Я тоже в классе" },
  {
    who: "Марина Петровна",
    at: "10:00",
    body: "Начинаем. Доска, слайды и задания переключаются у всех сразу — готовилась один раз.",
  },
];

/** Три шага — как переписка в чате урока (разметка сообщений из RoomPage.chatPanel). */
export function HowItWorks() {
  return (
    <section id="how" className="relative border-y border-border bg-white py-24 sm:py-32">
      <div className="container-l grid gap-14 lg:grid-cols-[1fr_minmax(0,460px)] lg:gap-20">
        <div>
          <SectionHeading title="От «создать» до «вести урок» — три шага" />
          <ol className="mt-12 max-w-md space-y-8">
            {[
              ["Создайте урок", "Название и время — это займёт минуту."],
              ["Пришлите ссылку", "Одна ссылка на весь класс. Ученик вводит имя — и в уроке."],
              ["Ведите урок", "Подготовились один раз — проводите сколько угодно раз."],
            ].map(([t, d], i) => (
              <Reveal as="li" key={t} delay={i * 130} className="flex gap-5">
                <span className="mt-0.5 text-lead font-bold tabular-nums text-primary">{i + 1}.</span>
                <span>
                  <span className="block text-lead font-bold tracking-tight text-foreground">{t}</span>
                  <span className="mt-1 block text-small text-muted-foreground">{d}</span>
                </span>
              </Reveal>
            ))}
          </ol>
        </div>

        <Reveal className="lesson-ui self-start overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div role="tablist" className="flex shrink-0 gap-1 border-b border-border p-2.5">
            {["Участники", "Чат", "Материалы"].map((t) => (
              <span
                key={t}
                className={
                  "inline-flex h-[34px] flex-1 items-center justify-center whitespace-nowrap rounded-full text-[13.5px] font-semibold " +
                  (t === "Чат" ? "bg-primary-light text-primary" : "text-text-2")
                }
              >
                {t}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-3 px-4 py-4">
            {MESSAGES.map((m, i) => (
              <ChatMsg
                key={i}
                delay={300 + i * 250}
                typingMs={700}
                className={m.cont ? "-mt-2" : ""}
                header={
                  m.cont ? null : (
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[13px] font-semibold text-foreground">{m.who}</span>
                      <span className="shrink-0 text-[11.5px] text-text-3">{m.at}</span>
                    </span>
                  )
                }
              >
                <span className="block self-start whitespace-pre-wrap break-words rounded-[10px] bg-surface-2 px-2.5 py-2 text-sm text-foreground">
                  {m.body}
                </span>
              </ChatMsg>
            ))}
          </div>
          <div className="flex gap-2 border-t border-border p-2.5">
            <span className="flex h-[38px] w-full items-center rounded-md border border-border bg-card px-3.5 text-sm text-muted-foreground shadow-xs">
              Сообщение классу…
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
