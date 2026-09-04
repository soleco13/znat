import { useEffect, useState } from "react";
import type { Material, QuestionInteraction, ReviewStudentResponse } from "@school/shared";
import { ApiError } from "../../shared/api-client.js";
import { sanitizeHtml } from "../../shared/sanitize-html.js";
import {
  getActivityReview,
  getReviewQuestionResponses,
  pushAnswerToBoard,
  startActivityReview,
} from "./activity-api.js";

type QuestionBlock = Extract<Material["blocks"][number], { type: "question" }>;

/** Убирает разметку из вариантов/пар (тот же приём, что серверный `stripHtml` в activities/analytics.ts). */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

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

  if (error) return <p className="text-xs text-red-600">{error}</p>;

  if (notReviewed) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-slate-400">Разбор ещё не начат</p>
        {isTeacher && (
          <button
            onClick={handleStart}
            disabled={starting}
            className="rounded border px-3 py-1 text-sm disabled:opacity-40"
          >
            {starting ? "Начинаем…" : "Начать разбор"}
          </button>
        )}
      </div>
    );
  }

  if (!material || !reviewedAt) {
    return <p className="text-xs text-slate-400">Загрузка разбора…</p>;
  }

  const questions = material.blocks.filter((b): b is QuestionBlock => b.type === "question");

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">Разбор начат {new Date(reviewedAt).toLocaleTimeString()}</p>
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
    <section className="rounded border p-3">
      <div className="mb-2 text-sm font-medium" dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.prompt.html) }} />
      <p className="mb-2 text-sm">
        <span className="text-xs text-slate-400">правильный ответ: </span>
        {formatCorrectAnswer(block.interaction)}
      </p>
      {isTeacher && (
        <div className="mt-2">
          <button
            onClick={() => setShowResponses((v) => !v)}
            className="rounded border px-2 py-1 text-xs text-slate-600"
          >
            {showResponses ? "Скрыть ответы учеников" : "Ответы учеников"}
          </button>
          {showResponses && (
            <StudentResponsesList activityId={activityId} questionId={block.id} interaction={block.interaction} />
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

  async function handlePush(userId: string) {
    setPushing(userId);
    try {
      await pushAnswerToBoard(activityId, { questionId, userId, anonymous });
    } catch {
      setError(true);
    } finally {
      setPushing(null);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <label className="flex items-center gap-1 text-xs text-slate-500">
        <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
        анонимно
      </label>
      {error && <p className="text-xs text-red-600">Не удалось загрузить/вынести ответ</p>}
      {!responses && !error && <p className="text-xs text-slate-400">Загрузка…</p>}
      {responses && responses.length === 0 && <p className="text-xs text-slate-400">Никто ещё не ответил</p>}
      <ul className="space-y-1">
        {responses?.map((r) => (
          <li key={r.userId} className="flex items-center justify-between gap-2 text-sm">
            <span>
              <span className="font-medium">{r.fullName}:</span> {formatResponse(interaction, r.response)}
            </span>
            <button
              onClick={() => handlePush(r.userId)}
              disabled={pushing === r.userId}
              className="shrink-0 rounded border px-2 py-0.5 text-xs disabled:opacity-40"
            >
              {pushing === r.userId ? "…" : "На доску"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Правильный ответ, текстом — то, что видит и ученик, и учитель после начала разбора. */
function formatCorrectAnswer(interaction: QuestionInteraction): string {
  switch (interaction.type) {
    case "single_choice":
    case "multiple_choice": {
      const correct = interaction.options.filter((o) => o.correct).map((o) => stripHtml(o.html));
      return correct.length > 0 ? correct.join(", ") : "—";
    }
    case "true_false":
      return interaction.correct ? "Верно" : "Неверно";
    case "text_input": {
      const literal = interaction.answers.filter((a) => a.match !== "regex").map((a) => a.value);
      return literal.length > 0 ? literal.join(" / ") : "—";
    }
    case "numeric_input":
      return interaction.unit ? `${interaction.value} ${interaction.unit}` : String(interaction.value);
    case "open_answer":
      return `по критериям: ${interaction.rubric.map((c) => c.label).join(", ")}`;
    case "cloze_dropdown":
      return Object.entries(interaction.gaps)
        .map(([gapId, gap]) => `${gapId}: ${gap.correct}`)
        .join("; ");
    case "cloze_text":
      return Object.entries(interaction.gaps)
        .map(([gapId, gap]) => {
          const literal = gap.answers.find((a) => a.match !== "regex");
          return `${gapId}: ${literal ? literal.value : "—"}`;
        })
        .join("; ");
    case "matching": {
      const leftById = new Map(interaction.left.map((i) => [i.id, stripHtml(i.html)]));
      const rightById = new Map(interaction.right.map((i) => [i.id, stripHtml(i.html)]));
      return interaction.pairs.map(([l, r]) => `${leftById.get(l) ?? l} → ${rightById.get(r) ?? r}`).join("; ");
    }
    case "ordering":
      // Порядок элементов В МАССИВЕ и есть правильный ответ (см. materials.ts).
      return interaction.items.map((i) => stripHtml(i.html)).join(" → ");
  }
}

/** Ответ ОДНОГО ученика, текстом — для списка «Ответы учеников» учителю. */
function formatResponse(interaction: QuestionInteraction, response: ReviewStudentResponse["response"]): string {
  if (response.type !== interaction.type) return "(несоответствие типа)";
  switch (interaction.type) {
    case "single_choice": {
      const r = response as Extract<typeof response, { type: "single_choice" }>;
      const opt = interaction.options.find((o) => o.id === r.selectedOptionId);
      return opt ? stripHtml(opt.html) : "(нет ответа)";
    }
    case "multiple_choice": {
      const r = response as Extract<typeof response, { type: "multiple_choice" }>;
      const opts = interaction.options.filter((o) => r.selectedOptionIds.includes(o.id));
      return opts.length > 0 ? opts.map((o) => stripHtml(o.html)).join(", ") : "(нет ответа)";
    }
    case "true_false": {
      const r = response as Extract<typeof response, { type: "true_false" }>;
      return r.value === null ? "(нет ответа)" : r.value ? "Верно" : "Неверно";
    }
    case "text_input": {
      const r = response as Extract<typeof response, { type: "text_input" }>;
      return r.value.trim() || "(нет ответа)";
    }
    case "numeric_input": {
      const r = response as Extract<typeof response, { type: "numeric_input" }>;
      if (r.value === null) return "(нет ответа)";
      return r.unit ? `${r.value} ${r.unit}` : String(r.value);
    }
    case "open_answer": {
      const r = response as Extract<typeof response, { type: "open_answer" }>;
      return r.text.trim() || "(нет ответа)";
    }
    case "cloze_dropdown": {
      const r = response as Extract<typeof response, { type: "cloze_dropdown" }>;
      return Object.entries(r.values)
        .map(([gapId, v]) => `${gapId}: ${v ?? "—"}`)
        .join("; ");
    }
    case "cloze_text": {
      const r = response as Extract<typeof response, { type: "cloze_text" }>;
      return Object.entries(r.values)
        .map(([gapId, v]) => `${gapId}: ${v || "—"}`)
        .join("; ");
    }
    case "matching": {
      const r = response as Extract<typeof response, { type: "matching" }>;
      const leftById = new Map(interaction.left.map((i) => [i.id, stripHtml(i.html)]));
      const rightById = new Map(interaction.right.map((i) => [i.id, stripHtml(i.html)]));
      if (r.pairs.length === 0) return "(нет ответа)";
      return r.pairs.map(([l, right]) => `${leftById.get(l) ?? l} → ${rightById.get(right) ?? right}`).join("; ");
    }
    case "ordering": {
      const r = response as Extract<typeof response, { type: "ordering" }>;
      const byId = new Map(interaction.items.map((i) => [i.id, stripHtml(i.html)]));
      if (r.order.length === 0) return "(нет ответа)";
      return r.order.map((id) => byId.get(id) ?? id).join(" → ");
    }
  }
}
