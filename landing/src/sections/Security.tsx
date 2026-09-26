import { Reveal } from "@/components/Reveal";
import { SectionHeading } from "@/components/SectionHeading";

const POINTS = [
  {
    title: "Урок не сорвётся",
    text: "Многие платформы собраны из чужих сервисов: отключился один — и занятие встало. Матис работает сам по себе, поэтому уроки идут по расписанию.",
  },
  {
    title: "Данные учеников в безопасности",
    text: "Всё хранится в России. Для сети школ можем установить платформу на ваш собственный сервер — тогда данные вообще никуда не уходят.",
  },
  {
    title: "По закону о персональных данных",
    text: "Ученик входит просто по имени — не нужно собирать телефоны и почты. Запись урока включается только с предупреждением всем участникам.",
  },
  {
    title: "Цена не вырастет посреди года",
    text: "Мы не зависим от иностранных сервисов, которые могут поднять цены, заблокировать аккаунт или уйти из России.",
  },
];

/** Схема: всё, что нужно уроку, — внутри Матиса; сторонние сервисы не участвуют. Линии прорисовываются при появлении. */
function Diagram() {
  const ink = (len: number, d: number, dash?: string) =>
    ({ className: "ink", style: { ["--len" as string]: len, ["--d" as string]: `${d}ms`, ["--dur" as string]: "0.9s" } as React.CSSProperties, strokeDasharray: dash });
  return (
    <svg viewBox="0 0 520 300" className="w-full" role="img" aria-label="Урок идёт внутри Матиса, без сторонних сервисов">
      {/* контур */}
      <rect x="150" y="30" width="360" height="240" rx="22" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.28)" strokeDasharray="6 7" />
      <text x="170" y="58" fontSize="13" fill="rgba(255,255,255,0.6)" fontFamily="var(--font)">всё внутри Матиса</text>

      {/* участники → сервер */}
      {[70, 150, 230].map((y, i) => (
        <g key={y}>
          <rect x="6" y={y - 16} width="96" height="32" rx="16" fill="rgba(255,255,255,0.08)" />
          <text x="54" y={y + 5} fontSize="12.5" textAnchor="middle" fill="#fff" fontFamily="var(--font)">
            {["Учитель", "Ученик", "Ученик"][i]}
          </text>
          <path d={`M102 ${y} C 180 ${y}, 200 150, 262 150`} fill="none" stroke="#c7d7fe" strokeWidth="2" strokeLinecap="round" {...ink(200, 300 + i * 200)} />
        </g>
      ))}

      <rect x="262" y="118" width="110" height="64" rx="14" fill="#1d4ed8" />
      <text x="317" y="146" fontSize="13" fontWeight="700" textAnchor="middle" fill="#fff" fontFamily="var(--font)">Урок</text>
      <text x="317" y="164" fontSize="11" textAnchor="middle" fill="rgba(255,255,255,0.75)" fontFamily="var(--font)">видео · доска</text>

      <path d="M372 150 H 410" fill="none" stroke="#c7d7fe" strokeWidth="2" strokeLinecap="round" {...ink(40, 1100)} />
      <rect x="410" y="122" width="88" height="56" rx="12" fill="rgba(255,255,255,0.08)" />
      <text x="454" y="147" fontSize="12.5" textAnchor="middle" fill="#fff" fontFamily="var(--font)">Запись</text>
      <text x="454" y="164" fontSize="11" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontFamily="var(--font)">видеофайл</text>

      {/* чужой сервис, перечёркнут */}
      <g opacity="0.9">
        <rect x="262" y="214" width="160" height="34" rx="17" fill="none" stroke="rgba(255,255,255,0.25)" strokeDasharray="4 5" />
        <text x="342" y="236" fontSize="12.5" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontFamily="var(--font)">сторонние сервисы</text>
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
            title="Спокойно за каждый урок"
            subtitle="Вы отвечаете перед учениками и родителями. Поэтому мы сделали так, чтобы урок не зависел ни от чьих серверов, кроме наших, а данные были под защитой."
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
              className="border-b border-white/15 py-8 sm:px-8 sm:odd:pl-0 sm:even:border-l sm:even:pr-0"
            >
              <h3 className="text-lead font-bold tracking-tight">{p.title}</h3>
              <p className="mt-2 max-w-[46ch] text-small text-white/70">{p.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
