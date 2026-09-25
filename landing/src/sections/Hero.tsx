import { ArrowRight } from "lucide-react";

import { Mark, Pencil, Words } from "@/components/Ink";
import { Reveal } from "@/components/Reveal";
import { useMedia } from "@/hooks/useMedia";
import { useScrollVar } from "@/hooks/useInView";
import { DESKTOP_H, DESKTOP_W, FitBox, PHONE_H, PHONE_W, PhoneWindow, RoomWindow } from "@/lesson/RoomWindow";

export function Hero() {
  const desktop = useMedia("(min-width: 768px)", true);
  const lift = useScrollVar<HTMLDivElement>("--sp", 1.0, 0.45);

  return (
    <section id="top" className="notebook relative overflow-hidden pb-20 pt-28 sm:pt-36">
      <div className="container-l relative">
        <h1 className="max-w-[15ch] text-[44px] font-black leading-[1.02] tracking-tightest text-foreground sm:max-w-[17ch] sm:text-[76px] lg:text-[96px]">
          <Words step={70}>
            Ведите{" "}
            <Mark d={900}>уроки</Mark>, а не жонглируйте{" "}
            <Pencil d={1500}>сервисами</Pencil>.
          </Words>
        </h1>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <Reveal delay={500} className="max-w-xl text-[18px] leading-relaxed text-muted-foreground sm:text-[20px]">
            Доска, слайды, материалы, задания, видео и запись — в одном окне урока. Ученик заходит по ссылке, без
            установки и аккаунта.
          </Reveal>
          <Reveal delay={650} className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="#pricing"
              className="btn-press group inline-flex h-[54px] items-center justify-center gap-2.5 rounded-[14px] bg-primary px-7 text-[16px] font-semibold text-primary-foreground hover:bg-primary-hover hover:shadow-[0_10px_30px_-8px_rgba(29,78,216,0.55)]"
            >
              14 дней бесплатно
              <ArrowRight className="size-[18px] transition-transform duration-200 group-hover:translate-x-1" />
            </a>
            <a
              href="#lesson"
              className="inline-flex h-[54px] items-center justify-center rounded-[14px] px-5 text-[16px] font-semibold text-foreground underline decoration-border decoration-2 underline-offset-[6px] transition-colors hover:decoration-primary"
            >
              Как проходит урок
            </a>
          </Reveal>
        </div>

        {/* Настоящее окно урока — те же плитки, доска и футер, что в приложении */}
        <Reveal delay={300} className="relative mt-14 sm:mt-20">
          <div ref={lift} className="scroll-lift mx-auto overflow-hidden rounded-[22px] border border-border bg-card shadow-xl">
            {desktop ? (
              <FitBox width={DESKTOP_W} height={DESKTOP_H} maxScale={1.05}>
                <RoomWindow scene="board" />
              </FitBox>
            ) : (
              <FitBox width={PHONE_W} height={PHONE_H}>
                <PhoneWindow scene="board" />
              </FitBox>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
