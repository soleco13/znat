import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[76px] w-full rounded-md border border-border bg-card px-3.5 py-2.5 text-[15px] text-foreground shadow-xs outline-none transition-[border-color,box-shadow] duration-150 ease-ds",
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
Textarea.displayName = "Textarea";

export { Textarea };
