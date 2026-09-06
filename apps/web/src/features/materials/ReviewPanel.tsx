import { useEffect, useState } from "react";
import type { Material, QuestionInteraction, ReviewStudentResponse } from "@school/shared";

import { ApiError } from "@/shared/api-client";
import { sanitizeHtml } from "@/shared/sanitize-html";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { CenteredSpinner } from "@/shared/ui/spinner";
import {
  getActivityReview,
  getReviewQuestionResponses,
  pushAnswerToBoard,
  startActivityReview,
} from "./activity-api.js";
import { formatCorrectAnswer, formatResponse } from "./answer-format.js";

type QuestionBlock = Extract<Material["blocks"][number], { type: "question" }>;

/**
 * Разбор задания (Э8.10, §7.3 ТЗ: «показать правильный ответ всем, вынести
 * чей-то ответ на доску»). Учитель и ученик читают ОДИН И ТОТ ЖЕ эндпоинт
 * (`GET /activities/:id/review`) — сервер решает, кому что можно (409, пока
 * разбор не начат учителем), фронт различает роли только видимостью кнопки
 * «Начать разбор» и панели «На доску».
 */
export function ReviewPanel({ activityId, isTeacher }: { activityId: string; isTeacher: boolean }) {
  const [material, setMaterial] = useState<Material | null>(null);
  const [reviewedAt, setReviewedAt] = useState<string | null>(null);
  const [notReviewed, setNotReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = async () => {
    try {
      const data = await getActivityReview(activityId);
      setMaterial(data.material);
      setReviewedAt(data.reviewedAt);
      setNotReviewed(false);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setNotReviewed(true);
      } else {
        setError("Не удалось загрузить разбор");
      }
    }
  };

  useEffect(() => {
    setMaterial(null);
    setNotReviewed(false);
    setError(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId]);

  async function handleStart() {
    setStarting(true);
    try {
      await startActivityReview(activityId);
      await load();
    } catch {
      setError("Не удалось начать разбор");
    } finally {
      setStarting(false);
    }
  }

  if (error) return <p className="text-sm font-medium text-destructive">{error}</p>;

  if (notReviewed) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Разбор ещё не начат</p>
        {isTeacher && (
          <Button variant="outline" size="sm" onClick={handleStart} loading={starting}>
            {starting ? "Начинаем…" : "Начать разбор"}
          </Button>
        )}
      </div>
    );
  }

  if (!material || !reviewedAt) {
    return <CenteredSpinner label="Загрузка разбора…" />;
  }

  const questions = material.blocks.filter((b): b is QuestionBlock => b.type === "question");

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Разбор начат {new Date(reviewedAt).toLocaleTimeString("ru-RU")}
      </p>
      {questions.map((block) => (
        <QuestionReview key={block.id} activityId={activityId} block={block} isTeacher={isTeacher} />
      ))}
    </div>
  );
}

function QuestionReview({
  activityId,
  block,
  isTeacher,
}: {
  activityId: string;
  block: QuestionBlock;
  isTeacher: boolean;
}) {
  const [showResponses, setShowResponses] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div
        className="prose mb-2 text-sm font-semibold"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.prompt.html) }}
      />
      <p className="mb-2 text-sm">
        <span className="text-xs font-medium uppercase tracking-wide text-success">правильный ответ: </span>
        {formatCorrectAnswer(block.interaction)}
      </p>
      {isTeacher && (
        <div className="mt-2">
          <Button variant="ghost" size="sm" onClick={() => setShowResponses((v) => !v)}>
            {showResponses ? "Скрыть ответы учеников" : "Ответы учеников"}
          </Button>
          {showResponses && (
            <StudentResponsesList
              activityId={activityId}
              questionId={block.id}
              interaction={block.interaction}
            />
          )}
        </div>
      )}
    </section>
  );
}

function StudentResponsesList({
  activityId,
  questionId,
  interaction,
}: {
  activityId: string;
  questionId: string;
  interaction: QuestionInteraction;
}) {
  const [responses, setResponses] = useState<ReviewStudentResponse[] | null>(null);
  const [error, setError] = useState(false);
  const [pushing, setPushing] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getReviewQuestionResponses(activityId, questionId)
      .then((data) => !cancelled && setResponses(data.responses))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [activityId, questionId]);

  async function handlePush(participantId: string) {
    setPushing(participantId);
    try {
      await pushAnswerToBoard(activityId, { questionId, participantId, anonymous });
    } catch {
      setError(true);
    } finally {
      setPushing(null);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={anonymous} onCheckedChange={(v) => setAnonymous(v === true)} />
        анонимно
      </label>
      {error && <p className="text-xs font-medium text-destructive">Не удалось загрузить/вынести ответ</p>}
      {!responses && !error && <p className="text-xs text-muted-foreground">Загрузка…</p>}
      {responses && responses.length === 0 && (
        <p className="text-xs text-muted-foreground">Никто ещё не ответил</p>
      )}
      <ul className="space-y-1.5">
        {responses?.map((r) => (
          <li
            key={r.participantId}
            className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm"
          >
            <span>
              <span className="font-semibold">{r.displayName}:</span>{" "}
              {formatResponse(interaction, r.response)}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => handlePush(r.participantId)}
              loading={pushing === r.participantId}
            >
              На доску
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

