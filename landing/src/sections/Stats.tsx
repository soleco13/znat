import { Reveal } from "@/components/Reveal";
import { CountUp } from "@/components/CountUp";

const STATS = [
  { value: <CountUp to={30} />, label: "учеников в групповом уроке" },
  { value: <CountUp to={22} />, label: "типа интерактивных заданий" },
  { value: <><CountUp to={1} /> ссылка</>, label: "на весь класс, без аккаунтов" },
  { value: <><CountUp to={5} /> сервисов</>, label: "заменяет одной подпиской" },
];

export function Stats() {
  return (
    <section className="relative py-6">
      <div className="container-l">
        <Reveal className="grid divide-y divide-border rounded-2xl border border-border bg-card shadow-sm sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {STATS.map((s, i) => (
            <div key={i} className="px-6 py-6 text-center">
              <div className="text-[30px] font-black tracking-tightest text-foreground">
                {s.value}
              </div>
              <div className="mt-1 text-[13px] leading-snug text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
