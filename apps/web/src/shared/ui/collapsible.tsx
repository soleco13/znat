import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";

// shadcn Collapsible — тонкая обёртка над Radix, стиля своего не несёт
// (анимацию раскрытия задаёт потребитель через data-state + утилиты).
const Collapsible = CollapsiblePrimitive.Root;
const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger;
const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent;

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
