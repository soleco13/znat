import { useEffect, useState } from "react";
import type {
  ActivityAnalytics,
  AnalyticsBar,
  QuestionAnalytics,
  QuestionDistribution,
} from "@school/shared";
import { getActivityAnalytics } from "./activity-api.js";
import { sanitizeHtml } from "../../shared/sanitize-html.js";

/**
 * Аналитика по вопросам задания (Э8.9, §7.3 ТЗ) — учителю: гистограмма
 * ответов, «17 из 24 выбрали B», верный вариант подсвечен, чтобы сразу
 * разобрать ошибку. Загружается по кнопке/на разборе, не поллится
 * постоянно (в отличие от панели прогресса Э8.8).
 */
export function QuestionAnalyticsPanel({ activityId }: { activityId: string }) {
  const [data, setData] = useState<ActivityAnalytics | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getActivityAnalytics(activityId)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [activityId]);

  if (error) return <p className="text-xs text-slate-400">Аналитика недоступна</p>;
  if (!data) return <p className="text-xs text-slate-400">Загрузка аналитики…</p>;

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-400">ответили: {data.respondents}</p>
      {data.questions.map((q) => (
        <QuestionBlock key={q.questionId} question={q} />
      ))}
    </div>
  );
}

function QuestionBlock({ question }: { question: QuestionAnalytics }) {
  return (
    <section className="rounded border p-3">
      <div
        className="mb-2 text-sm font-medium"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(question.promptHtml) }}
      />
      <p className="mb-2 text-xs text-slate-400">
        {question.interactionType} · ответов: {question.totalAnswered}
      </p>
      <DistributionView distribution={question.distribution} total={question.totalAnswered} />
    </section>
  );
}

function DistributionView({
  distribution,
  total,
}: {
  distribution: QuestionDistribution;
  total: number;
}) {
  switch (distribution.kind) {
    case "choice":
      return <Histogram bars={distribution.bars} total={total} />;
    case "text":
      return (
        <div className="space-y-1">
          <Histogram bars={distribution.bars} total={total} />
          {distribution.otherDistinct > 0 && (
            <p className="text-xs text-slate-400">…и ещё {distribution.otherDistinct} различных ответов</p>
          )}
        </div>
      );
    case "gaps":
      return (
        <div className="space-y-3">
          {distribution.gaps.map((g) => (
            <div key={g.gapId}>
              <p className="mb-1 text-xs text-slate-500">пропуск {g.gapId}</p>
              <Histogram bars={g.bars} total={total} />
            </div>
          ))}
        </div>
      );
    case "summary":
      return (
        <p className="text-sm">
          верно: {distribution.correctCount} · частично: {distribution.partialCount} · неверно:{" "}
          {distribution.incorrectCount}
        </p>
      );
  }
}

function Histogram({ bars, total }: { bars: AnalyticsBar[]; total: number }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <ul className="space-y-1">
      {bars.map((bar) => (
        <li key={bar.key} className="flex items-center gap-2 text-sm">
          <span className="w-40 shrink-0 truncate" title={bar.label}>
            {bar.correct === true && <span aria-label="верный вариант">✓ </span>}
            {bar.label}
          </span>
          <span className="h-4 flex-1 rounded bg-slate-100">
            <span
              className={`block h-4 rounded ${bar.correct === true ? "bg-emerald-500" : "bg-sky-400"}`}
              style={{ width: `${(bar.count / max) * 100}%` }}
            />
          </span>
          <span className="w-16 shrink-0 text-right text-xs text-slate-500">
            {bar.count}
            {total > 0 && ` (${Math.round((bar.count / total) * 100)}%)`}
          </span>
        </li>
      ))}
    </ul>
  );
}
