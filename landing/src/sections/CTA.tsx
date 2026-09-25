import { ArrowRight } from "lucide-react";

import { Ring, Words } from "@/components/Ink";
import { Reveal } from "@/components/Reveal";

export function CTA() {
  return (
    <section id="cta" className="notebook relative overflow-hidden py-28 sm:py-40">
      <div className="container-l relative">
        <Words as="h2" step={60} className="max-w-[16ch] text-[44px] font-black leading-[1.02] tracking-tightest sm:text-[84px]">
          Проведите следующий урок в одном окне
        </Words>

        <Reveal delay={400} className="mt-10 max-w-xl text-[19px] leading-relaxed text-muted-foreground">
          <Ring d={900}>14 дней</Ring> бесплатно. Настройка занимает вечер, а не квартал. Ученики уже завтра заходят по
          одной ссылке.
        </Reveal>

        <Reveal delay={550} className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
          <a
            href="#pricing"
            className="btn-press group inline-flex h-[58px] items-center justify-center gap-2.5 rounded-[16px] bg-primary px-8 text-[17px] font-semibold text-primary-foreground hover:bg-primary-hover hover:shadow-[0_12px_34px_-8px_rgba(29,78,216,0.6)]"
          >
            Начать бесплатно
            <ArrowRight className="size-[19px] transition-transform duration-200 group-hover:translate-x-1" />
          </a>
          <a
            href="#demo"
            className="inline-flex h-[58px] items-center justify-center px-5 text-[17px] font-semibold text-foreground underline decoration-border decoration-2 underline-offset-[7px] transition-colors hover:decoration-primary"
          >
            Запросить демонстрацию
          </a>
        </Reveal>

        <Reveal delay={650} className="mt-6 text-[14px] text-text-3">
          Есть вопросы по внедрению в сеть школ? Напишите — покажем на вашем материале.
        </Reveal>
      </div>
    </section>
  );
}
