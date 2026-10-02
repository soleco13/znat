import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { PublicQuestionBlock, QuestionResponse, SubmitFeedbackItem } from "@school/shared";

import { cn } from "@/lib/utils";
import { sanitizeHtml } from "@/shared/sanitize-html";
import { InteractionPlayer } from "../QuestionPlayer.js";
import { pointsLabel } from "./structure.js";

/**
 * Задание внутри страницы учебника: номер и баллы на полях, формулировка,
 * поле ответа (те же плееры взаимодействий, что и раньше), подсказка по
 * запросу и итог проверки после сдачи. Рамки-карточки нет: задание отбито
 * линией и номером, как упражнение в учебнике.
 */
export function TaskMargin({ number, points }: { number: number; points: number }) {
  return (
    <>
      <span className="tb-task-num">{number}</span>
      <span className="tb-task-pts">
        {formatPoints(points)} {pointsLabel(points)}
      </span>
    </>
  );
}

export function TextbookTask({
  block,
  number,
  value,
  onChange,
  disabled,
  result,
}: {
  block: PublicQuestionBlock;
  number: number;
  value: QuestionResponse | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled: boolean;
  result?: SubmitFeedbackItem;
}) {
  const [hintOpen, setHintOpen] = useState(false);
  const promptId = `tb-task-${block.id}`;

  return (
    <section aria-labelledby={promptId}>
      <h3 className="sr-only">Задание {number}</h3>
      <div
        id={promptId}
        className="prose tb-prompt"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.prompt.html) }}
      />
      {block.hint ? (
        <div className="mt-1">
          <button
            type="button"
            className="tb-textbtn"
            aria-expanded={hintOpen}
            onClick={() => setHintOpen((v) => !v)}
          >
            <ChevronRight aria-hidden />
            Подсказка
          </button>
          {hintOpen ? (
            <div
              className="prose tb-hint"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.hint.html) }}
            />
          ) : null}
        </div>
      ) : null}
      <div className={cn("tb-answer", block.hint && "mt-1")}>
        <InteractionPlayer
          questionId={block.id}
          interaction={block.interaction}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
      {result ? <TaskResult result={result} /> : null}
    </section>
  );
}

function TaskResult({ result }: { result: SubmitFeedbackItem }) {
  const score = `${formatPoints(result.score)} из ${formatPoints(result.maxScore)}`;
  if (!result.autoGraded || result.correct === null) {
    return <p className="tb-result tb-result--manual">Проверит учитель</p>;
  }
  if (result.correct) {
    return <p className="tb-result tb-result--right">Верно, {score}</p>;
  }
  if (result.score > 0) {
    return <p className="tb-result tb-result--part">Частично верно, {score}</p>;
  }
  return <p className="tb-result tb-result--wrong">Неверно, {score}</p>;
}

function formatPoints(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}
