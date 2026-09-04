import { useState } from "react";
import type { MyActivity, QuestionResponse } from "@school/shared";
import { QuestionPlayer } from "./QuestionPlayer.js";
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
 * Контентные блоки §6.2, требующие KaTeX/пайплайна ассетов (`formula`,
 * `image`, `video`, `audio`, `embed`), пока показываются заглушкой —
 * KaTeX в бандл и StorageAdapter для вложений подключаются отдельно
 * (новые зависимости — по согласованию, CLAUDE.md).
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
  const autosave = useActivityAutosave(autosaveActivityId);

  const handleChange = (questionId: string, response: QuestionResponse) => {
    setResponses((prev) => ({ ...prev, [questionId]: response }));
    if (autosaveActivityId) autosave.queue(questionId, response);
    onResponseChange?.(questionId, response);
  };

  return (
    <div className="space-y-4">
      <MaterialHeader activity={activity} autosaveStatus={autosaveActivityId ? autosave.status : null} />
      {activity.material.blocks.map((block) => (
        <BlockView
          key={block.id}
          block={block}
          response={responses[block.id]}
          onChange={handleChange}
          disabled={disabled}
        />
      ))}
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

function ContentBlockView({ block }: { block: Exclude<Block, { type: "question" }> }) {
  switch (block.type) {
    case "rich_text":
      return <div className="prose text-sm" dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.html) }} />;
    case "callout":
      return (
        <div className="rounded border-l-4 border-slate-300 bg-slate-50 p-3 text-sm">
          <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.html) }} />
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
      return <code className="block rounded bg-slate-100 px-2 py-1 text-sm">{block.latex}</code>;
    case "image":
    case "video":
    case "audio":
    case "embed":
      return (
        <div className="rounded border border-dashed p-3 text-xs text-slate-400">
          [{block.type}] — рендер подключается отдельно (ассеты/встраивание)
        </div>
      );
  }
}
