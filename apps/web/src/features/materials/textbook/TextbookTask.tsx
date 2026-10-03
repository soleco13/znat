import { useState } from "react";
import { Check, CircleDot, Clock, Lightbulb, X } from "lucide-react";
import type { PublicQuestionBlock, QuestionResponse, SubmitFeedbackItem } from "@school/shared";

import { cn } from "@/lib/utils";
import { sanitizeHtml } from "@/shared/sanitize-html";
import { InteractionPlayer } from "../QuestionPlayer.js";
import { pointsLabel } from "./structure.js";

/** Состояние метки задания: нет ответа → есть ответ → итог проверки. */
export type TaskState = "empty" | "answered" | "right" | "part" | "wrong" | "manual";

export function taskState(answered: boolean, result: SubmitFeedbackItem | undefined): TaskState {
  if (result) {
    if (!result.autoGraded || result.correct === null) return "manual";
    if (result.correct) return "right";
    return result.score > 0 ? "part" : "wrong";
  }
  return answered ? "answered" : "empty";
}

/**
 * Задание внутри страницы учебника: слева метка-кружок с номером и баллами,
 * справа формулировка, поле ответа (те же плееры взаимодействий), подсказка по
 * запросу и итог проверки после сдачи. Рамки-карточки нет: задание отбито
 * линией и номером, как упражнение в учебнике.
 */
export function TaskMark({
  number,
  points,
  state,
}: {
  number: number;
  points: number;
  state: TaskState;
}) {
  return (
    <div className="tb-task-mark">
      <span className={cn("tb-task-num", state !== "empty" && `tb-task-num--${state}`)}>
        {number}
      </span>
      <span className="tb-task-pts">
        {formatPoints(points)} {pointsLabel(points)}
      </span>
    </div>
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
      <div className="tb-answer">
        <InteractionPlayer
          questionId={block.id}
          interaction={block.interaction}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
      {block.hint ? (
        <div className="tb-task-tools">
          <button
            type="button"
            className="tb-textbtn"
            aria-expanded={hintOpen}
            onClick={() => setHintOpen((v) => !v)}
          >
            <Lightbulb aria-hidden />
            Подсказка
          </button>
        </div>
      ) : null}
      {block.hint && hintOpen ? (
        <div
          className="prose tb-hint"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.hint.html) }}
        />
      ) : null}
      {result ? <TaskResult result={result} /> : null}
    </section>
  );
}

function TaskResult({ result }: { result: SubmitFeedbackItem }) {
  const score = `${formatPoints(result.score)} из ${formatPoints(result.maxScore)}`;
  const state = taskState(true, result);
  return (
    <p className={cn("tb-result", `tb-result--${state}`)}>
      {state === "manual" ? (
        <>
          <Clock aria-hidden />
          Проверит учитель
        </>
      ) : state === "right" ? (
        <>
          <Check aria-hidden />
          Верно · {score}
        </>
      ) : state === "part" ? (
        <>
          <CircleDot aria-hidden />
          Частично · {score}
        </>
      ) : (
        <>
          <X aria-hidden />
          Неверно · {score}
        </>
      )}
    </p>
  );
}

function formatPoints(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}
