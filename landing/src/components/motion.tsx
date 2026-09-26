import * as React from "react";
import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, type Variants } from "motion/react";

import { cn } from "@/lib/utils";

export const EASE = [0.16, 1, 0.3, 1] as const;

/** Появление снизу при попадании в поле зрения. */
export function FadeUp({
  children,
  delay = 0,
  y = 28,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.8, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09 } },
};
export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

/** Контейнер, дети которого (`motion.*` с `variants={staggerChild}`) появляются по очереди. */
export function Stagger({
  children,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "ul" | "ol";
}) {
  const C = motion[as];
  return (
    <C className={className} variants={staggerParent} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.15 }}>
      {children}
    </C>
  );
}

/** «Магнитная» обёртка: элемент слегка тянется за курсором. */
export function Magnetic({ children, strength = 0.25, className }: { children: React.ReactNode; strength?: number; className?: string }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18 });
  const sy = useSpring(y, { stiffness: 220, damping: 18 });
  return (
    <motion.div
      className={cn("inline-flex", className)}
      style={{ x: sx, y: sy }}
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left - r.width / 2) * strength);
        y.set((e.clientY - r.top - r.height / 2) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/** Полоска прогресса чтения страницы под шапкой. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 });
  return (
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left bg-gradient-to-r from-primary via-[#3b82f6] to-[var(--c-cyan)]"
      style={{ scaleX }}
    />
  );
}

/** Мягкие «северные» пятна света на фоне секции. */
export function Aurora({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const blob = (cls: string, anim: { x: number[]; y: number[] }, dur: number) => (
    <motion.div
      className={cn("absolute rounded-full blur-3xl", cls)}
      animate={reduce ? undefined : { x: anim.x, y: anim.y, scale: [1, 1.12, 1] }}
      transition={{ duration: dur, repeat: Infinity, ease: "easeInOut" }}
    />
  );
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {blob("left-[-10%] top-[-20%] size-[560px] bg-[#3b82f6]/30", { x: [0, 80, 0], y: [0, 40, 0] }, 18)}
      {blob("right-[-8%] top-[5%] size-[480px] bg-[#06d6c4]/25", { x: [0, -60, 0], y: [0, 60, 0] }, 22)}
      {blob("bottom-[-25%] left-[30%] size-[520px] bg-[#8b5cf6]/20", { x: [0, 50, 0], y: [0, -40, 0] }, 26)}
    </div>
  );
}

/** Бесконечная бегущая строка; на hover замедляется, при reduced-motion стоит. */
export function Marquee({ children, duration = 40, className }: { children: React.ReactNode; duration?: number; className?: string }) {
  return (
    <div
      className={cn(
        "group/mq flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]",
        className,
      )}
    >
      {[0, 1].map((k) => (
        <div
          key={k}
          aria-hidden={k === 1}
          className="marquee-track flex shrink-0 items-center gap-4 pr-4 group-hover/mq:[animation-play-state:paused]"
          style={{ animationDuration: `${duration}s` }}
        >
          {children}
        </div>
      ))}
    </div>
  );
}
