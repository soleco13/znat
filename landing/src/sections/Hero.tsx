import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";

import { Pencil, Words } from "@/components/Ink";
import { EASE } from "@/components/motion";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMedia } from "@/hooks/useMedia";
import { DESKTOP_H, DESKTOP_W, FitBox, PHONE_H, PHONE_W, PhoneWindow, RoomWindow } from "@/lesson/RoomWindow";

const TRUST = ["14 дней бесплатно", "Без привязки карты", "Запуск за один вечер"];

export function Hero() {
  const desktop = useMedia("(min-width: 768px)", true);

  const up = (delay: number) => ({
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay, ease: EASE },
  });

  return (
    <section id="top" className="notebook relative overflow-clip pb-20 pt-28 sm:pt-36">
      <div className="container-l relative">
        <p className="text-small font-semibold text-text-2">Для репетиторов и онлайн-школ</p>

        {/* Единственный «учительский» жест на экране: красный карандаш вычёркивает то, от чего избавляем. */}
        <h1 className="mt-5 max-w-[15ch] text-display text-foreground sm:max-w-[17ch]">
          <Words step={70}>
            Ведите уроки, а не жонглируйте <Pencil d={1300}>сервисами</Pencil>.
          </Words>
        </h1>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <motion.div {...up(0.45)} className="max-w-xl">
            <p className="text-lead text-muted-foreground">
              Видеосвязь, доска, презентации и задания — в одной вкладке. Ученик нажимает на ссылку и сразу
              оказывается на уроке: ничего не нужно скачивать и регистрироваться.
            </p>
            <p className="mt-5 text-small font-semibold text-foreground">
              {TRUST.map((t, i) => (
                <span key={t}>
                  {i > 0 ? <span className="mx-2 text-text-3" aria-hidden>·</span> : null}
                  <span className="whitespace-nowrap">{t}</span>
                </span>
              ))}
            </p>
          </motion.div>

          <motion.div {...up(0.6)} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <a href="#pricing" className={cn(buttonVariants({ size: "cta" }), "group w-full sm:w-auto")}>
              Попробовать бесплатно
              <ArrowRight className="transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
            </a>
            <a href="#lesson" className={buttonVariants({ variant: "quiet", size: "cta" })}>
              Посмотреть, как проходит урок
            </a>
          </motion.div>
        </div>

        {/* Настоящее окно урока — те же плитки, доска и футер, что в приложении */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.3, ease: EASE }}
          className="relative mt-14 sm:mt-20"
        >
          <div className="hero-rise overflow-hidden rounded-lg border border-border bg-card shadow-md">
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
        </motion.div>
      </div>
    </section>
  );
}
