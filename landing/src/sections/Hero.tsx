import { ArrowRight, Play, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Aurora } from "@/components/Aurora";
import { Reveal } from "@/components/Reveal";
import { BrowserFrame } from "@/components/BrowserFrame";
import { ProductMock } from "@/components/ProductMock";

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-28 sm:pt-36">
      <Aurora />

      <div className="container-l relative">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal
            as="span"
            className="inline-flex items-center gap-2 rounded-pill border border-primary-muted/70 bg-primary-light/70 px-3.5 py-1.5 text-[13px] font-semibold text-primary"
          >
            <Sparkles className="size-3.5" />
            Один холст вместо шести вкладок
          </Reveal>

          <Reveal
            as="div"
            delay={70}
            className="mt-6 text-[38px] font-black leading-[1.05] tracking-tightest text-foreground sm:text-[62px]"
          >
            Ведите уроки,
            <br className="hidden sm:block" /> а не{" "}
            <span className="text-gradient animate-gradient-pan">жонглируйте сервисами</span>
          </Reveal>

          <Reveal
            as="p"
            delay={140}
            className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-muted-foreground sm:text-[19px]"
          >
            Доска, слайды, учебные материалы, интерактивные задания, видео и запись —
            в едином пространстве урока. Ученик заходит по ссылке, без установки и аккаунта.
          </Reveal>

          <Reveal
            as="div"
            delay={210}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Button asChild size="xl" className="w-full sm:w-auto">
              <a href="#pricing">
                Попробовать 14 дней бесплатно
                <ArrowRight className="size-[1.15em]" />
              </a>
            </Button>
            <Button asChild variant="secondary" size="xl" className="w-full sm:w-auto">
              <a href="#canvas">
                <Play className="size-[1.05em] fill-current" />
                Посмотреть, как устроен урок
              </a>
            </Button>
          </Reveal>

          <Reveal
            as="p"
            delay={260}
            className="mt-4 text-[13px] text-text-3"
          >
            Без карты. Данные — на вашем сервере или в нашем облаке.
          </Reveal>
        </div>

        {/* ── Витрина продукта ── */}
        <Reveal
          as="div"
          delay={120}
          className="relative mx-auto mt-14 max-w-5xl [perspective:2000px] sm:mt-20"
        >
          <div className="absolute -inset-x-12 -top-10 bottom-4 -z-10 rounded-[48px] bg-gradient-to-b from-primary/12 via-teal/8 to-transparent blur-3xl" />
          <div className="rounded-[26px] border border-white/60 bg-white/40 p-1.5 shadow-xl backdrop-blur-md sm:p-2.5">
            <div className="animate-float-slow [animation-duration:18s] [transform:rotateX(3deg)]">
              <BrowserFrame>
                <ProductMock />
              </BrowserFrame>
            </div>
          </div>
          {/* мягкое отражение под макетом */}
          <div className="pointer-events-none mx-auto -mt-2 h-28 w-[80%] rounded-[50%] bg-primary/10 blur-2xl" />
        </Reveal>
      </div>

      {/* плавный переход к светлой полосе ниже */}
      <div className="pointer-events-none h-24 bg-gradient-to-b from-transparent to-background" />
    </section>
  );
}
