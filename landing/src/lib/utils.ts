import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge не знает типографическую шкалу из tailwind.config.ts и принимает
 * `text-body` за цвет — тогда он выкидывает соседний `text-primary-foreground`.
 * Регистрируем шкалу как font-size.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["caption", "small", "body", "lead", "h3", "h2", "display"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
