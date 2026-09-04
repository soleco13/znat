import { useEffect, useRef, useState } from "react";
import type { ActivityProgress, StudentProgress, StudentProgressStatus } from "@school/shared";
import { getActivityProgress } from "./activity-api.js";

/** Как часто учитель опрашивает прогресс класса — «живая картина» без пуша (§7.3 ТЗ). */
const POLL_MS = 4_000;

/**
 * Панель прогресса класса по заданию (Э8.8, §7.3 ТЗ) — учителю: кто открыл,
 * кто отвечает, кто застрял. Опрос `GET /activities/:id/progress`, не пуш:
 * точности «раз в несколько секунд» для класса достаточно.
 */
export function ClassProgressPanel({ activityId }: { activityId: string }) {
  const [progress, setProgress] = useState<ActivityProgress | null>(null);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await getActivityProgress(activityId);
        if (!cancelled) {
          setProgress(next);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    };
    void tick();
    timer.current = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, [activityId]);

  if (!progress) {
    return <p className="text-xs text-slate-400">{error ? "Прогресс недоступен" : "Загрузка прогресса…"}</p>;
  }

  const counts = tally(progress.students);

  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-xs text-slate-500">
        <span>ответили: {counts.done}</span>
        <span>в работе: {counts.in_progress}</span>
        <span>застряли: {counts.stuck}</span>
        <span>не начали: {counts.not_started}</span>
        {error && <span className="text-amber-600">обновление прервалось</span>}
      </div>
      <ul className="divide-y text-sm">
        {progress.students.map((s) => (
          <li key={s.userId} className="flex items-center justify-between py-1.5">
            <span className="flex items-center gap-2">
              <StatusDot status={s.status} />
              {s.fullName}
            </span>
            <span className="text-xs text-slate-400">
              {s.answered}/{s.total}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function tally(students: StudentProgress[]) {
  const counts = { not_started: 0, in_progress: 0, stuck: 0, done: 0 };
  for (const s of students) {
    if (s.status === "in_progress" && s.total > 0 && s.answered >= s.total) counts.done += 1;
    else counts[s.status] += 1;
  }
  return counts;
}

const DOT_CLASS: Record<StudentProgressStatus, string> = {
  not_started: "bg-slate-300",
  in_progress: "bg-sky-500",
  stuck: "bg-amber-500",
};

function StatusDot({ status }: { status: StudentProgressStatus }) {
  const label =
    status === "not_started" ? "не начал" : status === "stuck" ? "застрял" : "в работе";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT_CLASS[status]}`} title={label} aria-label={label} />;
}
