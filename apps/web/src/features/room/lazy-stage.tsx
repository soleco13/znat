import { Suspense, type ComponentProps } from "react";

import { lazyNamed, withRetry } from "@/shared/lazy-retry";
import { Skeleton } from "@/shared/ui/skeleton";

/**
 * Тяжёлые части урока — отдельными кусками сборки. Доска тянет Excalidraw,
 * задания — KaTeX/mathlive/редактор: вместе мегабайты, а для входа в урок
 * (видео, звук, участники) они не нужны. Раньше всё приложение было одним
 * файлом 4,9 МБ (1,5 МБ gzip), и на мобильной сети с потерями страница урока
 * не открывалась вовсе. Куски начинают качаться сразу при входе в урок
 * (`prefetchLessonStage`), так что к моменту показа доски они обычно уже есть.
 */

const loadBoard = withRetry(() => import("../canvas/Board.js"));
const loadActivityPanel = withRetry(() => import("../materials/LessonActivityPanel.js"));
const loadActivityStage = withRetry(() => import("./ActivityStage.js"));

const LazyBoard = lazyNamed(loadBoard, "Board");
const LazyActivityPanel = lazyNamed(loadActivityPanel, "LessonActivityPanel");
const LazyActivityStage = lazyNamed(loadActivityStage, "ActivityStage");

/** Запускает загрузку кусков урока заранее — ошибки не важны, `lazy` повторит при показе. */
export function prefetchLessonStage(): void {
  for (const load of [loadBoard, loadActivityStage, loadActivityPanel]) load().catch(() => undefined);
}

function StageFallback() {
  return <Skeleton className="size-full min-h-40 rounded-xl" />;
}

type BoardProps = ComponentProps<typeof import("../canvas/Board.js").Board>;
type ActivityPanelProps = ComponentProps<typeof import("../materials/LessonActivityPanel.js").LessonActivityPanel>;
type ActivityStageProps = ComponentProps<typeof import("./ActivityStage.js").ActivityStage>;

export function Board(props: BoardProps) {
  return (
    <Suspense fallback={<StageFallback />}>
      <LazyBoard {...props} />
    </Suspense>
  );
}

export function LessonActivityPanel(props: ActivityPanelProps) {
  return (
    <Suspense fallback={<StageFallback />}>
      <LazyActivityPanel {...props} />
    </Suspense>
  );
}

export function ActivityStage(props: ActivityStageProps) {
  return (
    <Suspense fallback={<StageFallback />}>
      <LazyActivityStage {...props} />
    </Suspense>
  );
}
