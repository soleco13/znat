import { useEffect, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { MyActivity, QuestionResponse, SubmitActivityResult } from "@school/shared";

import { sanitizeHtml } from "@/shared/sanitize-html";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/shared/ui/accordion";
import { Button } from "@/shared/ui/button";
import { QuestionPlayer } from "./QuestionPlayer.js";
import { SlideDeck } from "./SlideDeck.js";
import { submitActivity } from "./activity-api.js";
import { getAssetUrl } from "./materials-api.js";
import { useActivityAutosave, type AutosaveStatus } from "./useActivityAutosave.js";

type Block = MyActivity["material"]["blocks"][number];

/**
 * Плеер материала целиком (Э8.6). Держит ответы всех вопросов в одном месте,
 * автосохранение через `useActivityAutosave`, сабмит с `flush()` перед
 * отправкой; после сабмита плеер блокируется целиком.
 */
export function MaterialPlayer({
  activity,
  autosaveActivityId = null,
  onResponseChange,
  disabled = false,
  slideOverlay,
  initialSlideBlockId = null,
  onSlideChange,
}: {
  activity: MyActivity;
  autosaveActivityId?: string | null;
  onResponseChange?: (questionId: string, response: QuestionResponse) => void;
  disabled?: boolean;
  /** Слой пометок учителя — рендерится поверх текущего слайда / всей колонки. */
  slideOverlay?: React.ReactNode;
  /** Открыть на слайде с этим блоком (доп. Э13). */
  initialSlideBlockId?: string | null;
  /** Смена слайда — id первого блока слайда (для отправки позиции на сервер). */
  onSlideChange?: (firstBlockId: string, index: number) => void;
}) {
  const [responses, setResponses] = useState<Record<string, QuestionResponse>>(
    () => ({ ...activity.savedResponses }),
  );
  const [submittedAt, setSubmittedAt] = useState<string | null>(activity.submittedAt);
  const [submitResult, setSubmitResult] = useState<SubmitActivityResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const autosave = useActivityAutosave(autosaveActivityId);

  const handleChange = (questionId: string, response: QuestionResponse) => {
    setResponses((prev) => ({ ...prev, [questionId]: response }));
    if (autosaveActivityId) autosave.queue(questionId, response);
    onResponseChange?.(questionId, response);
  };

  async function handleSubmit() {
    if (!autosaveActivityId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await autosave.flush();
      const result = await submitActivity(autosaveActivityId);
      setSubmitResult(result);
      setSubmittedAt(new Date().toISOString());
    } catch {
      setSubmitError("Не удалось сдать работу — попробуйте ещё раз");
    } finally {
      setSubmitting(false);
    }
  }

  const locked = disabled || submittedAt !== null;

  // `data-annot-block` — якорь для слоя пометок учителя (Э13): у учителя и
  // ученика материал рендерится разной вёрсткой, Y-координаты штрихов
  // привязаны к верху блока, а не к верху контента.
  const blockNode = (block: Block) => (
    <div data-annot-block={block.id}>
      <BlockView
        block={block}
        response={responses[block.id]}
        onChange={handleChange}
        disabled={locked}
      />
    </div>
  );

  const header = (
    <MaterialHeader
      activity={activity}
      autosaveStatus={autosaveActivityId ? autosave.status : null}
    />
  );
  const submitBar = autosaveActivityId ? (
    <SubmitBar
      submittedAt={submittedAt}
      result={submitResult}
      submitting={submitting}
      error={submitError}
      onSubmit={handleSubmit}
    />
  ) : null;

  if (activity.material.settings.layout === "slides") {
    return (
      <SlideDeck
        blocks={activity.material.blocks}
        renderBlock={blockNode}
        header={header}
        footer={submitBar ?? undefined}
        overlay={slideOverlay}
        initialBlockId={initialSlideBlockId}
        onSlideChange={onSlideChange}
      />
    );
  }

  return (
    <div className="relative space-y-5">
      {header}
      {activity.material.blocks.map((block) => (
        <div key={block.id}>{blockNode(block)}</div>
      ))}
      {submitBar}
      {slideOverlay}
    </div>
  );
}

function SubmitBar({
  submittedAt,
  result,
  submitting,
  error,
  onSubmit,
}: {
  submittedAt: string | null;
  result: SubmitActivityResult | null;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  if (submittedAt) {
    return (
      <div className="rounded-lg border border-success/25 bg-success/5 p-4 text-sm">
        <p className="font-semibold text-foreground">
          Работа сдана {new Date(submittedAt).toLocaleString("ru-RU")}
        </p>
        {result && !result.revealed && (
          <p className="mt-0.5 text-xs text-muted-foreground">Результаты покажет учитель.</p>
        )}
        {result && result.revealed && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {result.score} из {result.maxScore} баллов автопроверкой
            {result.feedback.some((f) => !f.autoGraded) &&
              " · часть вопросов ждёт проверки учителем"}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button size="lg" onClick={onSubmit} loading={submitting}>
        {submitting ? "Отправляем…" : "Сдать работу"}
      </Button>
    </div>
  );
}

function MaterialHeader({
  activity,
  autosaveStatus,
}: {
  activity: MyActivity;
  autosaveStatus: AutosaveStatus | null;
}) {
  const { material, deadline, timerSeconds, startedAt } = activity;
  return (
    <header className="border-b border-border pb-3">
      <h2 className="text-lg font-bold tracking-tight">{material.title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {material.subject}
        {deadline && ` · дедлайн ${new Date(deadline).toLocaleString("ru-RU")}`}
        {timerSeconds != null && ` · ${formatTimer(startedAt, timerSeconds)}`}
        {autosaveStatus && ` · ${autosaveLabel(autosaveStatus)}`}
      </p>
    </header>
  );
}

function autosaveLabel(status: AutosaveStatus): string {
  switch (status) {
    case "saving":
      return "сохранение…";
    case "saved":
      return "сохранено";
    case "error":
      return "не сохранено — повторим";
    case "idle":
      return "черновик";
  }
}

/** Оставшееся время попытки, минуты:секунды. Отсчёт от `startedAt` сервера. */
function formatTimer(startedAt: string, timerSeconds: number): string {
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const leftSec = Math.max(0, Math.round(timerSeconds - elapsedMs / 1000));
  const mm = Math.floor(leftSec / 60);
  const ss = String(leftSec % 60).padStart(2, "0");
  return `осталось ${mm}:${ss}`;
}

function BlockView({
  block,
  response,
  onChange,
  disabled,
}: {
  block: Block;
  response: QuestionResponse | undefined;
  onChange: (questionId: string, response: QuestionResponse) => void;
  disabled: boolean;
}) {
  if (block.type === "question") {
    return (
      <QuestionPlayer
        block={block}
        value={response}
        onChange={(r) => onChange(block.id, r)}
        disabled={disabled}
      />
    );
  }
  return <ContentBlockView block={block} />;
}

/** Экспортируется отдельно — переиспользуется превью редактора (Э9.2). */
export function ContentBlockView({ block }: { block: Exclude<Block, { type: "question" }> }) {
  switch (block.type) {
    case "rich_text":
      return (
        <div
          className="prose text-sm"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.html) }}
        />
      );
    case "callout":
      return (
        <div className="rounded-lg border-l-4 border-primary/40 bg-primary/5 p-3 text-sm">
          <div className="prose" dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.html) }} />
        </div>
      );
    case "spoiler":
      return (
        <Accordion type="single" collapsible className="rounded-lg border border-border">
          <AccordionItem value={block.id} className="border-none">
            <AccordionTrigger className="px-3 py-2 text-sm font-medium hover:no-underline">
              {block.title}
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3">
              <div className="prose text-sm" dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.html) }} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-border px-2 py-1">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "page_break":
      return <hr className="border-dashed border-border" />;
    case "formula":
      return <FormulaView latex={block.latex} />;
    case "image":
      return <ImageAssetView block={block} />;
    case "audio":
      return <AudioAssetView block={block} />;
    case "video":
      return (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Видео
        </div>
      );
    case "embed":
      return (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Интерактивный блок ({block.provider})
        </div>
      );
  }
}

function FormulaView({ latex }: { latex: string }) {
  let html: string;
  try {
    html = katex.renderToString(latex, { throwOnError: false });
  } catch {
    html = `<span class="text-destructive">Ошибка в формуле</span>`;
  }
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function useAssetUrl(assetId: string): { url: string | null; error: boolean } {
  const [state, setState] = useState<{ url: string | null; error: boolean }>({
    url: null,
    error: false,
  });
  useEffect(() => {
    let cancelled = false;
    setState({ url: null, error: false });
    getAssetUrl(assetId)
      .then((res) => !cancelled && setState({ url: res.url, error: false }))
      .catch(() => !cancelled && setState({ url: null, error: true }));
    return () => {
      cancelled = true;
    };
  }, [assetId]);
  return state;
}

function ImageAssetView({ block }: { block: Extract<Block, { type: "image" }> }) {
  const { url, error } = useAssetUrl(block.assetId);
  if (error) return <p className="text-xs text-destructive">Не удалось загрузить изображение</p>;
  if (!url) return <p className="text-xs text-muted-foreground">Загрузка изображения…</p>;
  return (
    <figure>
      <img src={url} alt={block.caption ?? ""} className="max-w-full rounded-lg border border-border" />
      {block.caption && (
        <figcaption className="mt-1 text-xs text-muted-foreground">{block.caption}</figcaption>
      )}
    </figure>
  );
}

function AudioAssetView({ block }: { block: Extract<Block, { type: "audio" }> }) {
  const { url, error } = useAssetUrl(block.assetId);
  if (error) return <p className="text-xs text-destructive">Не удалось загрузить аудио</p>;
  if (!url) return <p className="text-xs text-muted-foreground">Загрузка аудио…</p>;
  return (
    <div>
      <audio src={url} controls className="w-full" />
      {block.transcript && (
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Транскрипт</summary>
          <p className="mt-1 whitespace-pre-wrap">{block.transcript}</p>
        </details>
      )}
    </div>
  );
}
