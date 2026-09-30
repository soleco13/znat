import * as React from "react";

import { cn } from "@/lib/utils";

/** shadcn/ui Kbd (реестр @shadcn, new-york-v4), под Tailwind 3 и токены проекта. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-[5px] border border-border bg-card px-1.5 font-sans text-[11px] font-bold text-muted-foreground [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"kbd">) {
  return <kbd data-slot="kbd-group" className={cn("inline-flex items-center gap-1", className)} {...props} />;
}

export { Kbd, KbdGroup };
