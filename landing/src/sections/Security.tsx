import { Fingerprint, Radio, Server, ShieldCheck } from "lucide-react";

import { Reveal } from "@/components/Reveal";

const POINTS = [
  {
    icon: Server,
    title: "Данные — там, где решаете вы",
    text: "Облако с российскими дата-центрами или полностью на вашем сервере. Уроки, записи, материалы не уезжают к третьим лицам.",
  },
  {
    icon: ShieldCheck,
    title: "Соответствие 152-ФЗ",
    text: "Ученик — не персональные данные: он входит по ссылке с именем и живёт в пределах урока. Согласие на запись фиксируется.",
  },
  {
    icon: Radio,
    title: "Свой медиасервер",
    text: "Видео идёт через ваш SFU, а не через чужой сервис, который может отключить аккаунт или поднять цену посреди учебного года.",
  },
  {
    icon: Fingerprint,
    title: "Ничего с чужих CDN",
    text: "Шрифты, формулы, иконки — в бандле. Урок не зависит от того, доступен ли сейчас сторонний сайт.",
  },
];

export function Security() {
  return (
    <section className="relative overflow-hidden bg-foreground py-20 text-white sm:py-28">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, #3b82f6, transparent 45%), radial-gradient(circle at 85% 30%, #06d6c4, transparent 45%)",
        }}
      />
      <div className="container-l relative">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <Reveal>
            <span className="eyebrow text-cyan">Независимость</span>
            <h2 className="mt-4 text-[30px] font-heavy leading-[1.1] tracking-tightest sm:text-[40px]">
              Платформа, а не аренда чужих кнопок
            </h2>
            <p className="mt-5 max-w-md text-[16px] leading-relaxed text-white/70">
              Мы не форкаем BigBlueButton и не собираем урок из iframe. Библиотеки вкомпилированы
              в приложение, вы владеете интерфейсом и данными. На критическом пути урока — ничего
              платного и ничего чужого.
            </p>
          </Reveal>

          <div className="grid gap-4 sm:grid-cols-2">
            {POINTS.map((p, i) => (
              <Reveal key={p.title} delay={i * 80}>
                <div className="h-full rounded-2xl border border-white/12 bg-white/[0.06] p-5 backdrop-blur">
                  <div className="grid size-10 place-items-center rounded-xl bg-white/10 text-cyan">
                    <p.icon className="size-5" />
                  </div>
                  <h3 className="mt-3 text-[15px] font-heavy">{p.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-white/65">{p.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
