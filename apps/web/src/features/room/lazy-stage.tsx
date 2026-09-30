import { Suspense, type ComponentProps } from "react";

import { warmChunk } from "@/shared/chunk-warmup";
import { lazyNamed } from "@/shared/lazy-retry";
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
 *
 * Перед `import()` файлы куска докачиваются с повторами (`warmChunk`): один
 * оборванный `import()` браузер запоминает до перезагрузки страницы, и на
 * слабой связи доска падала с ошибкой, хотя сеть уже восстановилась.
 */

const BOARD = "src/features/canvas/Board.tsx";
const ACTIVITY_PANEL = "src/features/materials/LessonActivityPanel.tsx";
const ACTIVITY_STAGE = "src/features/room/ActivityStage.tsx";

async function loadBoard() {
  await warmChunk(BOARD);
  return import("../canvas/Board.js");
}
async function loadActivityPanel() {
  await warmChunk(ACTIVITY_PANEL);
  return import("../materials/LessonActivityPanel.js");
}
async function loadActivityStage() {
  await warmChunk(ACTIVITY_STAGE);
  return import("./ActivityStage.js");
}

const LazyBoard = lazyNamed(loadBoard, "Board");
const LazyActivityPanel = lazyNamed(loadActivityPanel, "LessonActivityPanel");
const LazyActivityStage = lazyNamed(loadActivityStage, "ActivityStage");

/**
 * Докачивает куски урока заранее. Только `fetch`, без `import()`: оборванный
 * здесь `import()` сломал бы кусок до перезагрузки страницы.
 */
export function prefetchLessonStage(): void {
  for (const module of [BOARD, ACTIVITY_STAGE, ACTIVITY_PANEL]) void warmChunk(module);
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
