import { useEffect, useState } from "react";
import type { MyActivity, QuestionResponse, SubmitActivityResult } from "@school/shared";

import { submitActivity } from "./activity-api.js";
import { useActivityAutosave, type AutosaveStatus } from "./useActivityAutosave.js";
import { TextbookView } from "./textbook/TextbookView.js";

/**
 * Плеер материала целиком (Э8.6). Держит ответы всех вопросов в одном месте,
 * автосохранение через `useActivityAutosave`, сабмит с `flush()` перед
 * отправкой; после сабмита плеер блокируется целиком. Показывает материал
 * учебником (`TextbookView`): страницы те же, что слайды в редакторе.
 */
export function MaterialPlayer({
  activity,
  autosaveActivityId = null,
  onResponseChange,
  disabled = false,
  slideOverlay,
  initialSlideBlockId = null,
  onPositionChange,
}: {
  activity: MyActivity;
  autosaveActivityId?: string | null;
  onResponseChange?: (questionId: string, response: QuestionResponse) => void;
  disabled?: boolean;
  /** Слой пометок учителя — рендерится поверх текущей страницы. */
  slideOverlay?: React.ReactNode;
  /** Открыть на месте с этим блоком (доп. Э13). */
  initialSlideBlockId?: string | null;
  /** Ученик читает этот блок (для отправки позиции на сервер). */
  onPositionChange?: (blockId: string) => void;
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
      // Не сохранились ответы — не сдаём: сервер оценил бы их как пустые, а
      // после сдачи исправить уже нельзя.
      if (!(await autosave.flush())) {
        setSubmitError("Не удалось сохранить ответы. Проверьте интернет и нажмите ещё раз");
        return;
      }
      const result = await submitActivity(autosaveActivityId);
      setSubmitResult(result);
      setSubmittedAt(new Date().toISOString());
    } catch {
      setSubmitError("Не удалось сдать работу. Попробуйте ещё раз");
    } finally {
      setSubmitting(false);
    }
  }

  const locked = disabled || submittedAt !== null;
  const meta = useMaterialMeta(activity, submittedAt === null, autosaveActivityId ? autosave.status : null);

  return (
    <TextbookView
      material={activity.material}
      responses={responses}
      onResponseChange={handleChange}
      disabled={locked}
      meta={meta}
      submit={
        autosaveActivityId
          ? {
              submittedAt,
              result: submitResult,
              submitting,
              error: submitError,
              onSubmit: () => void handleSubmit(),
            }
          : undefined
      }
      overlay={slideOverlay}
      initialBlockId={initialSlideBlockId}
      onPositionChange={onPositionChange}
    />
  );
}

/** Дедлайн, остаток времени и состояние сохранения — одной строкой под заголовком. */
function useMaterialMeta(
  activity: MyActivity,
  running: boolean,
  autosaveStatus: AutosaveStatus | null,
): string | undefined {
  const { deadline, timerSeconds, startedAt } = activity;
  const [, tick] = useState(0);
  useEffect(() => {
    if (timerSeconds == null || !running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [timerSeconds, running]);

  const parts: string[] = [];
  if (deadline) parts.push(`сдать до ${new Date(deadline).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`);
  if (timerSeconds != null && running) parts.push(formatTimer(startedAt, timerSeconds));
  if (autosaveStatus && running) parts.push(autosaveLabel(autosaveStatus));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function autosaveLabel(status: AutosaveStatus): string {
  switch (status) {
    case "saving":
      return "сохраняем ответы…";
    case "saved":
      return "ответы сохранены";
    case "error":
      return "ответы не сохранились, повторим";
    case "idle":
      return "ответы сохраняются сами";
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
