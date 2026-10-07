import { Suspense } from "react";

import { ErrorBoundary } from "@/shared/ErrorBoundary";
import { lazyNamed } from "@/shared/lazy-retry";

/**
 * Поле ввода формулы — отдельным куском: MathLive (~800 КБ, ~200 КБ сжатым)
 * нужен, только когда формулу правят, а раньше качался при каждом открытии
 * редактора материалов. Кусок грузится при первом показе поля (поповер
 * «Изменить формулу», поля выбранного формульного блока). Своя
 * `ErrorBoundary`: если кусок не догрузился, ломается только поле, а не
 * весь редактор.
 */
const FormulaEditorImpl = lazyNamed(() => import("./FormulaEditor.js"), "FormulaEditor");

type Props = { latex: string; onChange: (latex: string) => void };

/** Пока MathLive грузится — та же рамка с исходным LaTeX, без правки. */
function FormulaFallback({ latex }: { latex: string }) {
  return (
    <div
      aria-busy="true"
      className="block min-h-9 w-full truncate rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-muted-foreground"
    >
      {latex || "…"}
    </div>
  );
}

export function FormulaEditor(props: Props) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<FormulaFallback latex={props.latex} />}>
        <FormulaEditorImpl {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}
