import { useId, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

/*
 * Фирменный лоадер: диск с двумя вырезами, которые меняются местами
 * (большой в центре ↔ маленький у края), пока диск вращается.
 *
 * Геометрия перенесена из исходного макета 325×325: внутренний круг 200,
 * «тень»-вырез 50 на 130 выше него; во второй фазе внутренний сжимается до 50
 * у нижнего края, а вырез над ним растёт до 200. В макете вырезы рисовались
 * цветом фона страницы — здесь это SVG-маска, поэтому вырезы прозрачные и
 * лоадер одинаково читается на странице, карточке, кнопке и тёмной плитке
 * видео. Цвет — `currentColor`, размер — классом `size-*`.
 */

const C = 162.5; // центр диска в координатах 325×325
const PHASE = "8s";
const KEY_TIMES = "0;0.25;0.5;0.75;1";
const EASE_IN_OUT = "0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1";

/** Большой вырез: центр → низ, r 100 → 25. */
const INNER = { cy: [C, C, 295, 295, C], r: [100, 100, 25, 25, 100] };
/** Второй вырез всегда на 130 выше первого: r 25 → 100. */
const SHADOW = { cy: [32.5, 32.5, 165, 165, 32.5], r: [25, 25, 100, 100, 25] };

const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribe(cb: () => void) {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useReducedMotion = () =>
  useSyncExternalStore(subscribe, () => window.matchMedia(REDUCED).matches, () => false);

function Animated({ values, attr }: { values: number[]; attr: "cy" | "r" }) {
  return (
    <animate
      attributeName={attr}
      values={values.join(";")}
      keyTimes={KEY_TIMES}
      keySplines={EASE_IN_OUT}
      calcMode="spline"
      dur={PHASE}
      repeatCount="indefinite"
    />
  );
}

/** Только графика (aria-hidden). Подпись и `role="status"` — у обёртки (`Spinner`, `CenteredSpinner`, `FullscreenLoader`). */
export function Loader({ className }: { className?: string }) {
  const maskId = `loader-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const reduced = useReducedMotion();
  return (
    <svg
      viewBox="0 0 325 325"
      className={cn("size-5 shrink-0", !reduced && "loader-rotate", className)}
      aria-hidden
      focusable="false"
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="325" height="325">
          <rect width="325" height="325" fill="#fff" />
          <circle cx={C} cy={INNER.cy[0]} r={INNER.r[0]} fill="#000">
            {reduced ? null : (
              <>
                <Animated attr="cy" values={INNER.cy} />
                <Animated attr="r" values={INNER.r} />
              </>
            )}
          </circle>
          <circle cx={C} cy={SHADOW.cy[0]} r={SHADOW.r[0]} fill="#000">
            {reduced ? null : (
              <>
                <Animated attr="cy" values={SHADOW.cy} />
                <Animated attr="r" values={SHADOW.r} />
              </>
            )}
          </circle>
        </mask>
      </defs>
      <circle cx={C} cy={C} r={C} fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}
