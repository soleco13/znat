import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";

const POINTS = [
  {
    title: "Данные — там, где решаете вы",
    text: "Облако с российскими дата-центрами или полностью на вашем сервере. Уроки, записи, материалы не уезжают к третьим лицам.",
  },
  {
    title: "Соответствие 152-ФЗ",
    text: "Ученик — не персональные данные: он входит по ссылке с именем и живёт в пределах урока. Согласие на запись фиксируется.",
  },
  {
    title: "Свой медиасервер",
    text: "Видео идёт через ваш SFU, а не через чужой сервис, который может отключить аккаунт или поднять цену посреди учебного года.",
  },
  {
    title: "Ничего с чужих CDN",
    text: "Шрифты, формулы, иконки — в бандле. Урок не зависит от того, доступен ли сейчас сторонний сайт.",
  },
];

/** Схема пути видео: всё внутри вашего контура, наружу — ничего. Линии прорисовываются при появлении. */
function Diagram() {
  const ink = (len: number, d: number, dash?: string) =>
    ({ className: "ink", style: { ["--len" as string]: len, ["--d" as string]: `${d}ms`, ["--dur" as string]: "0.9s" } as React.CSSProperties, strokeDasharray: dash });
  return (
    <svg viewBox="0 0 520 300" className="w-full" role="img" aria-label="Видео идёт через ваш сервер, без сторонних сервисов">
      {/* контур */}
      <rect x="150" y="30" width="360" height="240" rx="22" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.28)" strokeDasharray="6 7" />
      <text x="170" y="58" fontSize="13" fill="rgba(255,255,255,0.6)" fontFamily="var(--font)">ваш контур</text>

      {/* участники → сервер */}
      {[70, 150, 230].map((y, i) => (
        <g key={y}>
          <rect x="6" y={y - 16} width="96" height="32" rx="16" fill="rgba(255,255,255,0.08)" />
          <text x="54" y={y + 5} fontSize="12.5" textAnchor="middle" fill="#fff" fontFamily="var(--font)">
            {["Учитель", "Ученик", "Ученик"][i]}
          </text>
          <path d={`M102 ${y} C 180 ${y}, 200 150, 262 150`} fill="none" stroke="#06d6c4" strokeWidth="2" strokeLinecap="round" {...ink(200, 300 + i * 200)} />
        </g>
      ))}

      <rect x="262" y="118" width="110" height="64" rx="14" fill="#1d4ed8" />
      <text x="317" y="146" fontSize="13" fontWeight="700" textAnchor="middle" fill="#fff" fontFamily="var(--font)">Медиасервер</text>
      <text x="317" y="164" fontSize="11" textAnchor="middle" fill="rgba(255,255,255,0.75)" fontFamily="var(--font)">SFU</text>

      <path d="M372 150 H 410" fill="none" stroke="#06d6c4" strokeWidth="2" strokeLinecap="round" {...ink(40, 1100)} />
      <rect x="410" y="122" width="88" height="56" rx="12" fill="rgba(255,255,255,0.08)" />
      <text x="454" y="147" fontSize="12.5" textAnchor="middle" fill="#fff" fontFamily="var(--font)">Запись</text>
      <text x="454" y="164" fontSize="11" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontFamily="var(--font)">MP4</text>

      {/* чужой сервис, перечёркнут */}
      <g opacity="0.9">
        <rect x="262" y="214" width="160" height="34" rx="17" fill="none" stroke="rgba(255,255,255,0.25)" strokeDasharray="4 5" />
        <text x="342" y="236" fontSize="12.5" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontFamily="var(--font)">чужой сервис / iframe</text>
        <path d="M252 246 L 432 216" fill="none" stroke="#f87171" strokeWidth="3" strokeLinecap="round" {...ink(200, 1500)} />
      </g>
    </svg>
  );
}

export function Security() {
  return (
    <section className="relative overflow-hidden bg-foreground py-24 text-white sm:py-32">
      <div className="container-l relative">
        <div className="grid gap-14 lg:grid-cols-[1fr_minmax(0,520px)] lg:items-center">
          <SectionHeading
            tone="dark"
            title="Платформа, а не аренда чужих кнопок"
            subtitle="Мы не форкаем BigBlueButton и не собираем урок из iframe. Библиотеки вкомпилированы в приложение, вы владеете интерфейсом и данными. На критическом пути урока — ничего платного и ничего чужого."
          />
          <Reveal>
            <Diagram />
          </Reveal>
        </div>

        <div className="mt-20 grid border-t border-white/15 sm:grid-cols-2">
          {POINTS.map((p, i) => (
            <Reveal
              key={p.title}
              delay={i * 80}
              className="border-b border-white/15 py-8 sm:px-8 sm:first:pl-0 sm:even:border-l sm:even:pr-0"
            >
              <h3 className="text-[20px] font-black tracking-tightest">{p.title}</h3>
              <p className="mt-2 max-w-[46ch] text-[15px] leading-relaxed text-white/65">{p.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
