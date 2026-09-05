import * as React from "react";

import { cn } from "@/lib/utils";

// .input из дизайн-системы: радиус 10, фокус — синяя рамка + мягкое кольцо
// 0 0 0 3.5px rgba(29,78,216,.12).
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-border bg-card px-3.5 py-2 text-[15px] text-foreground shadow-xs outline-none transition-[border-color,box-shadow] duration-150 ease-ds",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "placeholder:text-muted-foreground",
          "focus-visible:border-primary focus-visible:ring-[3.5px] focus-visible:ring-primary/15",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/15",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
