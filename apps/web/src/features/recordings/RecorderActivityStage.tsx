import { useEffect, useState } from "react";
import "katex/dist/katex.min.css";
import type { RecorderActivityView, StudentProgress } from "@school/shared";
import { sanitizeHtml } from "@/shared/sanitize-html";
import { Badge } from "@/shared/ui/badge";
import { getRecorderActivityView } from "./recorder-api.js";

const POLL_MS = 5_000;

const STATUS_LABEL: Record<StudentProgress["status"], string> = {
  not_started: "не начал",
  in_progress: "отвечает",
  stuck: "застрял",
};

/**
 * Э10.6 — «лист с заданиями» в кадре записи, когда стейдж урока = activity.
 * НЕ `ActivityStage`/`MaterialPlayer` (те — интерактивный плеер ученика и
 * панель учителя с переходом к конкретному ученику): recorder видит только
 * агрегированный, учительский вид мониторинга (решение пользователя,
 * 2026-09-11) — вопросы материала БЕЗ ключей + прогресс класса по именам/
 * статусам, НИ ОДНОГО личного ответа. Собственный простой рендер, без
 * интерактива (recorder ни с чем не взаимодействует, кадр должен быть чистым).
 */
export function RecorderActivityStage({
  activityId,
  recorderToken,
}: {
  activityId: string;
  recorderToken: string;
}) {
  const [view, setView] = useState<RecorderActivityView | null>(null);

  useEffect(() => {
    let cancelled = false;
    setView(null);
    const load = () =>
      getRecorderActivityView(activityId, recorderToken)
        .then((v) => !cancelled && setView(v))
        .catch(() => {
          /* следующий опрос повторит — то же самое, что делает ActivityStage при временном сбое */
        });
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [activityId, recorderToken]);

  if (!view) return null;

  const questions = view.material.blocks.filter((b) => b.type === "question");

  return (
    <div className="flex h-full min-h-0 w-full items-stretch gap-4 overflow-hidden bg-card p-6">
      <div className="min-w-0 flex-[2] overflow-y-auto">
        <h1 className="mb-4 text-lg font-heavy text-foreground">{view.materialTitle}</h1>
        <ol className="space-y-3">
          {questions.map((q, i) => (
            <li key={q.id} className="rounded-lg border border-border p-3">
              <span className="mb-1 block text-xs text-muted-foreground">Вопрос {i + 1}</span>
              <div
                className="prose text-sm"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(q.prompt.html) }}
              />
            </li>
          ))}
        </ol>
      </div>
      <div className="w-72 shrink-0 overflow-y-auto border-l border-border pl-4">
        <h2 className="mb-3 text-sm font-heavy text-foreground">
          Класс — {view.progress.students.length}
        </h2>
        <ul className="space-y-1.5">
          {view.progress.students.map((s) => (
            <li key={s.participantId} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{s.displayName}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {s.answered}/{s.total}
              </span>
              <Badge variant={s.status === "stuck" ? "destructive" : "secondary"} className="shrink-0">
                {STATUS_LABEL[s.status]}
              </Badge>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
