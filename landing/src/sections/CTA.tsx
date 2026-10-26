import { ArrowRight } from "lucide-react";

import { Reveal } from "@/components/Reveal";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SUPPORT_EMAIL, SUPPORT_TELEGRAM, SUPPORT_TELEGRAM_URL } from "@/lib/contacts";

export function CTA() {
  return (
    <section id="cta" className="notebook relative overflow-hidden py-28 sm:py-40">
      <div className="container-l relative">
        <Reveal>
          <h2 className="max-w-[16ch] text-display">Проведите следующий урок в одном окне</h2>
        </Reveal>

        <Reveal delay={150} className="mt-10 max-w-xl text-lead text-muted-foreground">
          <span className="font-semibold text-foreground">14 дней</span> бесплатно. Настроить всё можно за один
          вечер — а уже завтра ученики придут на урок по одной ссылке.
        </Reveal>

        <Reveal delay={250} className="mt-10 flex flex-col gap-2 sm:flex-row sm:items-center">
          <a href="#pricing" className={cn(buttonVariants({ size: "cta" }), "group w-full sm:w-auto")}>
            Начать бесплатно
            <ArrowRight className="transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
          </a>
          <a href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "quiet", size: "cta" })}>
            Запросить демонстрацию
          </a>
        </Reveal>

        <Reveal delay={300} className="mt-6 text-small text-text-3">
          Есть вопросы по внедрению в сеть школ? Напишите в Telegram {SUPPORT_TELEGRAM} или на {SUPPORT_EMAIL} — покажем
          на вашем материале.
        </Reveal>
      </div>
    </section>
  );
}
