import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Кнопка дизайн-системы «Матис» (as-is из apps/web/src/shared/ui/button,
 * + размер `xl` для hero-CTA лендинга).
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-all duration-150 ease-ds focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-[1.15em] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover hover:shadow-[0_10px_30px_-6px_rgba(29,78,216,0.5)] active:translate-y-px",
        secondary:
          "border border-border bg-card text-foreground shadow-sm hover:bg-secondary hover:border-primary-muted active:translate-y-px",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-secondary hover:text-foreground",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
        teal: "bg-teal text-teal-foreground shadow-xs hover:bg-teal/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 text-[15px]",
        sm: "h-8 rounded-[9px] px-3 text-[13.5px] gap-1.5",
        lg: "h-12 rounded-md px-5 text-base",
        xl: "h-[52px] rounded-lg px-7 text-[16px] tracking-[-0.01em]",
        icon: "size-10 rounded-[9px]",
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
