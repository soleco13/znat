import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// .badge из дизайн-системы: пилюля, тинт-фон + насыщенный текст, вес 600.
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap transition-colors [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary-light text-primary",
        blue: "bg-primary-light text-primary",
        green: "bg-success-light text-success",
        success: "bg-success-light text-success",
        yellow: "bg-warn-light text-warn",
        warning: "bg-warn-light text-[#b45309]",
        red: "bg-danger-light text-danger",
        destructive: "bg-danger-light text-danger",
        gray: "bg-surface-3 text-muted-foreground",
        secondary: "bg-surface-3 text-muted-foreground",
        muted: "bg-surface-3 text-muted-foreground",
        teal: "bg-teal-light text-teal",
        outline: "border border-border text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
