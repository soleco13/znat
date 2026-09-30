import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * Знак «Матис» (docs/brand/logo/06-favicon.svg): диск с центральным вырезом и
 * «спутником», прорезающим верхний край — застывший кадр фирменного лоадера
 * (shared/ui/loader.tsx), упрощённый, чтобы читаться от 16 px.
 * Цвет — `currentColor`, размер — классом `size-*`.
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  const maskId = `brand-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      viewBox="0 0 325 325"
      className={cn("size-8 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="325" height="325">
          <rect width="325" height="325" fill="#fff" />
          <circle cx="162.5" cy="162.5" r="72" fill="#000" />
          <circle cx="162.5" cy="14" r="44" fill="#000" />
        </mask>
      </defs>
      <circle cx="162.5" cy="162.5" r="162.5" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}
