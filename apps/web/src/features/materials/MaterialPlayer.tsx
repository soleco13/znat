import { useEffect, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { MyActivity, QuestionResponse, SubmitActivityResult } from "@school/shared";
import { QuestionPlayer } from "./QuestionPlayer.js";
import { submitActivity } from "./activity-api.js";
import { getAssetUrl } from "./materials-api.js";
import { useActivityAutosave, type AutosaveStatus } from "./useActivityAutosave.js";
import { sanitizeHtml } from "../../shared/sanitize-html.js";

type Block = MyActivity["material"]["blocks"][number];

/**
 * Плеер материала целиком (Э8.6) — то, что Э8.4/8.5 отложили как «забота
 * будущего плеера материала». Получает `MyActivity` (индивидуальная копия
 * от `GET /activities/:id/my`: без ключей ответов, свой порядок вариантов),
 * держит ответы всех вопросов в одном месте.
 *
 * Автосохранение (Э8.7): если задан `autosaveActivityId`, каждое изменение
 * ставится в очередь `useActivityAutosave` (раз в 5 сек + при потере фокуса).
 * `onResponseChange` — дополнительный хук для вызывающей стороны.
 *
 * Сабмит (Э8.12, §8 ТЗ): кнопка «Сдать работу» видна, только пока задан
 * `autosaveActivityId` (не превью учителя) и попытка ещё не сдана
 * (`activity.submittedAt === null`). Перед отправкой — `autosave.flush()`,
 * чтобы последний непойманный дебаунсом черновик не потерялся молча.
 * После успешного сабмита плеер блокируется целиком (`disabled` изнутри,
 * независимо от пропа) — сервер всё равно откажет дальнейшим
 * `saveResponse`, но без локальной блокировки поля выглядели бы
 * редактируемыми, вводя в заблуждение.
 *
 * Контентные блоки §6.2: `formula` рендерится через KaTeX (Э9.4, в бандле —
 * `import "katex/dist/katex.min.css"` тянет собственные шрифты как ассеты
 * Vite, ни один запрос не уходит на чужой домен, CLAUDE.md). `image`/`audio`
 * рендерятся через реальный файл медиатеки (Э9.7, `GET /assets/:id/url` —
 * доступен и ученику, не только автору материала). `video`/`embed`
 * по-прежнему заглушка — видео в медиатеке вне плана Э9.7, встраивание
 * (GeoGebra/Desmos/JSXGraph) не в этом срезе вообще.
 */
export function MaterialPlayer({
  activity,
  autosaveActivityId = null,
  onResponseChange,
  disabled = false,
}: {
  activity: MyActivity;
  /** id активности для автосохранения черновиков; `null` — плеер без сохранения (превью учителя). */
  autosaveActivityId?: string | null;
  onResponseChange?: (questionId: string, response: QuestionResponse) => void;
  disabled?: boolean;
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

  return (
    <div className="space-y-4">
      <MaterialHeader activity={activity} autosaveStatus={autosaveActivityId ? autosave.status : null} />
      {activity.material.blocks.map((block) => (
        <BlockView
          key={block.id}
          block={block}
          response={responses[block.id]}
          onChange={handleChange}
          disabled={locked}
        />
      ))}
      {autosaveActivityId && (
        <SubmitBar
          submittedAt={submittedAt}
          result={submitResult}
          submitting={submitting}
          error={submitError}
          onSubmit={handleSubmit}
        />
      )}
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
      <div className="rounded border bg-slate-50 p-3 text-sm">
        <p className="font-medium">Работа сдана {new Date(submittedAt).toLocaleString()}</p>
        {result && (
          <p className="text-xs text-slate-500">
            {result.score} из {result.maxScore} баллов автопроверкой
            {result.feedback.some((f) => !f.autoGraded) && " · часть вопросов ждёт проверки учителем"}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        onClick={onSubmit}
        disabled={submitting}
        className="rounded border bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40"
      >
        {submitting ? "Отправляем…" : "Сдать работу"}
      </button>
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
    <header className="border-b pb-2">
      <h2 className="text-lg font-semibold">{material.title}</h2>
      <p className="text-xs text-slate-400">
        {material.subject}
        {deadline && ` · дедлайн ${new Date(deadline).toLocaleString()}`}
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

/** Оставшееся время попытки, минуты:секунды. Отсчёт от `startedAt` сервера — источник правды по дедлайну всё равно на сервере (Э8.7/8.10). */
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

/** Экспортируется отдельно — переиспользуется превью редактора (Э9.2, `MaterialEditorPage`). */
export function ContentBlockView({ block }: { block: Exclude<Block, { type: "question" }> }) {
  switch (block.type) {
    case "rich_text":
      return <div className="prose text-sm" dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.html) }} />;
    case "callout":
      return (
        <div className="rounded border-l-4 border-slate-300 bg-slate-50 p-3 text-sm">
          <div className="prose" dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.html) }} />
        </div>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border px-2 py-1">
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
      return <hr className="border-dashed" />;
    case "formula":
      return <FormulaView latex={block.latex} />;
    case "image":
      return <ImageAssetView block={block} />;
    case "audio":
      return <AudioAssetView block={block} />;
    case "video":
    case "embed":
      return (
        <div className="rounded border border-dashed p-3 text-xs text-slate-400">
          [{block.type}] — рендер подключается отдельно (ассеты/встраивание)
        </div>
      );
  }
}

/** `throwOnError: false` уже не бросает на большинстве опечаток в LaTeX (KaTeX сам вписывает место ошибки красным в разметку) — try/catch на крайний случай катастрофического сбоя рендера, `latex` может прийти и не из MathLive (seed-скрипт/Postman, Э8). */
function FormulaView({ latex }: { latex: string }) {
  let html: string;
  try {
    html = katex.renderToString(latex, { throwOnError: false });
  } catch {
    html = `<span class="text-red-600">Ошибка в формуле</span>`;
  }
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Резолв `assetId → подписанная ссылка` (Э9.7, `GET /assets/:id/url`) — ОДИН
 * и тот же для editor-превью и для настоящего плеера ученика (оба через
 * `ContentBlockView`), никакого спецпути для методиста: у него нет заранее
 * загруженного списка медиатеки под рукой в этой панели, только `assetId`
 * из содержимого блока, как и у ученика.
 */
function useAssetUrl(assetId: string): { url: string | null; error: boolean } {
  const [state, setState] = useState<{ url: string | null; error: boolean }>({ url: null, error: false });
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
  if (error) return <p className="text-xs text-red-600">Не удалось загрузить изображение</p>;
  if (!url) return <p className="text-xs text-slate-400">Загрузка изображения…</p>;
  return (
    <figure>
      <img src={url} alt={block.caption ?? ""} className="max-w-full rounded" />
      {block.caption && <figcaption className="mt-1 text-xs text-slate-500">{block.caption}</figcaption>}
    </figure>
  );
}

function AudioAssetView({ block }: { block: Extract<Block, { type: "audio" }> }) {
  const { url, error } = useAssetUrl(block.assetId);
  if (error) return <p className="text-xs text-red-600">Не удалось загрузить аудио</p>;
  if (!url) return <p className="text-xs text-slate-400">Загрузка аудио…</p>;
  return (
    <div>
      <audio src={url} controls className="w-full" />
      {block.transcript && (
        <details className="mt-1 text-xs text-slate-500">
          <summary className="cursor-pointer">Транскрипт</summary>
          <p className="mt-1 whitespace-pre-wrap">{block.transcript}</p>
        </details>
      )}
    </div>
  );
}
