import { Suspense, type ComponentProps } from "react";

import { lazyNamed, withRetry } from "@/shared/lazy-retry";
import { ErrorBoundary } from "@/shared/ErrorBoundary";
import { MediaLoader } from "@/shared/ui/media-loader";

/**
 * Тяжёлые части урока — отдельными кусками сборки. Доска тянет Excalidraw,
 * задания — KaTeX/mathlive/редактор: вместе мегабайты, а для входа в урок
 * (видео, звук, участники) они не нужны. Раньше всё приложение было одним
 * файлом 4,9 МБ (1,5 МБ gzip), и на мобильной сети с потерями страница урока
 * не открывалась вовсе. Куски начинают качаться сразу при входе в урок
 * (`prefetchLessonStage`), так что к моменту показа доски они обычно уже есть.
 *
 * Своя `ErrorBoundary` на каждый кусок: если он не догрузился, ошибка остаётся
 * в его области, а видео и звук урока продолжают работать. Раньше сбой
 * загрузки доски ронял всю страницу урока, и ученик вылетал с урока.
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

function StageFallback({ label }: { label: string }) {
  return (
    <div className="relative size-full min-h-40 overflow-hidden rounded-2xl border border-border bg-card">
      <MediaLoader label={label} tone="light" size="lg" />
    </div>
  );
}

type BoardProps = ComponentProps<typeof import("../canvas/Board.js").Board>;
type ActivityPanelProps = ComponentProps<typeof import("../materials/LessonActivityPanel.js").LessonActivityPanel>;
type ActivityStageProps = ComponentProps<typeof import("./ActivityStage.js").ActivityStage>;

export function Board(props: BoardProps) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<StageFallback label="Загружаем доску…" />}>
        <LazyBoard {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

export function LessonActivityPanel(props: ActivityPanelProps) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<StageFallback label="Загружаем задания…" />}>
        <LazyActivityPanel {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

export function ActivityStage(props: ActivityStageProps) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<StageFallback label="Загружаем задание…" />}>
        <LazyActivityStage {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}
