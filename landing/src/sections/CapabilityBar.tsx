import { Marquee } from "@/components/Marquee";
import { Reveal } from "@/components/Reveal";

const ITEMS = [
  "Групповые уроки до 30 учеников",
  "Индивидуальные занятия",
  "Общая доска в реальном времени",
  "Слайды из PPTX и PDF",
  "22 типа интерактивных заданий",
  "Автопроверка и ручная проверка",
  "Запись урока в MP4",
  "Живой опрос класса",
  "Вход ученика по ссылке",
  "Работает в браузере, без установки",
];

export function CapabilityBar() {
  return (
    <section className="relative py-10 sm:py-14">
      <div className="container-l">
        <Reveal className="text-center text-[13px] font-semibold uppercase tracking-[0.14em] text-text-3">
          Всё, что нужно уроку — внутри одной вкладки
        </Reveal>
      </div>
      <Reveal className="mt-6">
        <Marquee durationSec={42}>
          {ITEMS.map((t) => (
            <span
              key={t}
              className="flex items-center gap-2 rounded-pill border border-border bg-card px-4 py-2 text-[14px] font-medium text-foreground shadow-xs"
            >
              <span className="size-1.5 rounded-full bg-primary" />
              {t}
            </span>
          ))}
        </Marquee>
      </Reveal>
    </section>
  );
}
