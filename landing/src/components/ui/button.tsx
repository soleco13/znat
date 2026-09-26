import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Кнопка лендинга «Матис». База — кнопка приложения (apps/web/src/shared/ui/button),
 * переопределена под лендинг: один радиус контролов (10px), без цветного
 * свечения и подъёма на hover — только смена фона и отклик на нажатие.
 * `cta` — главная кнопка страницы (hero, финальный призыв, тарифы).
 * `quiet` — вторичное действие текстом с подчёркиванием, не второй «призрак».
 */
const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-[background-color,color,text-decoration-color,transform] duration-150 ease-ds active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-[1.1em] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        secondary: "border border-border bg-card text-foreground shadow-xs hover:bg-secondary",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
        quiet:
          "text-foreground underline decoration-border decoration-2 underline-offset-[6px] hover:decoration-primary active:scale-100",
      },
      size: {
        default: "h-10 px-4 text-small",
        sm: "h-9 px-3 text-[14px]",
        cta: "h-14 px-7 text-body",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
