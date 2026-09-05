import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

// Формы и веса — из дизайн-системы Shkola/AutoCheck (.btn*, components.css):
// радиус 10, вес 600, easing cubic-bezier(.2,.8,.2,1), тень при hover у primary/teal.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-all duration-150 ease-ds focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover hover:shadow-[0_4px_12px_rgba(29,78,216,0.28)]",
        secondary:
          "border border-border bg-card text-foreground shadow-xs hover:bg-secondary hover:border-primary-muted",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-secondary hover:text-foreground",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        teal: "bg-teal text-teal-foreground shadow-xs hover:bg-teal/90 hover:shadow-[0_4px_12px_rgba(13,148,136,0.28)]",
        success: "bg-success text-success-foreground shadow-xs hover:bg-success/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 text-[15px]",
        sm: "h-8 rounded-[9px] px-3 text-[13.5px] gap-1.5",
        lg: "h-12 rounded-md px-5 text-base",
        icon: "size-10 rounded-[9px]",
        "icon-sm": "size-8 rounded-[9px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Спиннер + блокировка; текст кнопки остаётся видимым. */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const showSpinner = loading && !asChild;
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={asChild ? disabled : (disabled ?? loading)}
        aria-busy={loading || undefined}
        {...props}
      >
        {showSpinner ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
