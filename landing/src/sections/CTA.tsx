import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Aurora } from "@/components/Aurora";
import { Reveal } from "@/components/Reveal";

export function CTA() {
  return (
    <section id="cta" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="container-l">
        <Reveal className="relative overflow-hidden rounded-[34px] border border-primary/30 bg-gradient-to-br from-primary via-[#2563eb] to-teal px-6 py-14 text-center text-white shadow-glow sm:px-12 sm:py-20">
          <Aurora variant="band" />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-[30px] font-black leading-[1.1] tracking-tightest sm:text-[46px]">
              Проведите следующий урок в едином холсте
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-[16px] leading-relaxed text-white/85 sm:text-[18px]">
              14 дней бесплатно. Настройка занимает вечер, а не квартал. Ученики уже завтра
              заходят по одной ссылке.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                asChild
                size="xl"
                variant="secondary"
                className="w-full border-transparent bg-white text-primary hover:bg-white/90 sm:w-auto"
              >
                <a href="#pricing">
                  Начать бесплатно
                  <ArrowRight className="size-[1.15em]" />
                </a>
              </Button>
              <Button
                asChild
                size="xl"
                variant="outline"
                className="w-full border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white sm:w-auto"
              >
                <a href="#demo">Запросить демонстрацию</a>
              </Button>
            </div>
            <p className="mt-4 text-[13px] text-white/70">
              Есть вопросы по внедрению в сеть школ? Напишите — покажем на вашем материале.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
