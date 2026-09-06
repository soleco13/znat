import * as React from "react";
import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// shadcn Toggle, адаптирован под токены дизайн-системы Shkola/AutoCheck
// (радиус 10, вес 600, easing ds). Вариант `media` + размер `circle` —
// для круглых кнопок вкл/выкл камеры и микрофона на экране проверки
// устройств и в комнате урока: state=on — устройство активно (нейтральный
// вид), state=off — выключено (красный, как «замьючено»).
const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-all duration-150 ease-ds focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground data-[state=on]:bg-primary-light data-[state=on]:text-primary",
        outline:
          "border border-border bg-card text-foreground shadow-xs hover:bg-secondary data-[state=on]:bg-primary-light data-[state=on]:text-primary data-[state=on]:border-primary-muted",
        media:
          "shadow-sm data-[state=on]:border data-[state=on]:border-border data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:hover:bg-secondary data-[state=off]:bg-destructive data-[state=off]:text-destructive-foreground data-[state=off]:hover:bg-destructive/90",
      },
      size: {
        default: "h-10 px-3",
        sm: "h-8 rounded-[9px] px-2",
        lg: "h-12 px-4",
        circle: "size-10 rounded-full [&_svg]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(toggleVariants({ variant, size, className }))}
    {...props}
  />
));

Toggle.displayName = TogglePrimitive.Root.displayName;

export { Toggle, toggleVariants };
