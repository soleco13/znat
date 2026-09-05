import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type {
  ActivityAnalytics,
  AnalyticsBar,
  QuestionAnalytics,
  QuestionDistribution,
} from "@school/shared";

import { sanitizeHtml } from "@/shared/sanitize-html";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { getActivityAnalytics } from "./activity-api.js";

/**
 * Аналитика по вопросам задания (Э8.9, §7.3 ТЗ) — гистограмма ответов,
 * верный вариант подсвечен. Загружается один раз, не поллится.
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

  if (error) return <p className="text-sm text-muted-foreground">Аналитика недоступна</p>;
  if (!data) return <CenteredSpinner label="Загрузка аналитики…" />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">ответили: {data.respondents}</p>
      {data.questions.map((q) => (
        <QuestionBlock key={q.questionId} question={q} />
      ))}
    </div>
  );
}

function QuestionBlock({ question }: { question: QuestionAnalytics }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div
        className="prose mb-2 text-sm font-semibold"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(question.promptHtml) }}
      />
      <p className="mb-3 text-xs text-muted-foreground">
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
            <p className="text-xs text-muted-foreground">
              …и ещё {distribution.otherDistinct} различных ответов
            </p>
          )}
        </div>
      );
    case "gaps":
      return (
        <div className="space-y-3">
          {distribution.gaps.map((g) => (
            <div key={g.gapId}>
              <p className="mb-1 text-xs text-muted-foreground">пропуск {g.gapId}</p>
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
    <ul className="space-y-1.5">
      {bars.map((bar) => (
        <li key={bar.key} className="flex items-center gap-2 text-sm">
          <span className="flex w-40 shrink-0 items-center gap-1 truncate" title={bar.label}>
            {bar.correct === true ? (
              <Check className="size-3.5 shrink-0 text-success" aria-label="верный вариант" />
            ) : null}
            {bar.label}
          </span>
          <span className="h-4 flex-1 overflow-hidden rounded-pill bg-surface-3">
            <span
              className={`block h-4 rounded-pill ${bar.correct === true ? "bg-success" : "bg-primary"}`}
              style={{ width: `${(bar.count / max) * 100}%` }}
            />
          </span>
          <span className="w-16 shrink-0 text-right text-xs font-medium text-muted-foreground">
            {bar.count}
            {total > 0 && ` (${Math.round((bar.count / total) * 100)}%)`}
          </span>
        </li>
      ))}
    </ul>
  );
}
