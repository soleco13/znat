import { useEffect, useRef, useState } from "react";
import type { ActivityProgress, StudentProgress, StudentProgressStatus } from "@school/shared";

import { UserAvatar } from "@/shared/ui/avatar";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { getActivityProgress } from "./activity-api.js";

/** Как часто учитель опрашивает прогресс класса — «живая картина» без пуша (§7.3 ТЗ). */
const POLL_MS = 4_000;

/**
 * Панель прогресса класса по заданию (Э8.8, §7.3 ТЗ). Опрос
 * `GET /activities/:id/progress`, не пуш.
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
    return error ? (
      <p className="text-sm text-muted-foreground">Прогресс недоступен</p>
    ) : (
      <CenteredSpinner label="Загрузка прогресса…" />
    );
  }

  const counts = tally(progress.students);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Stat label="ответили" value={counts.done} tone="green" />
        <Stat label="в работе" value={counts.in_progress} tone="blue" />
        <Stat label="застряли" value={counts.stuck} tone="yellow" />
        <Stat label="не начали" value={counts.not_started} tone="gray" />
        {error ? <span className="self-center text-warning">обновление прервалось</span> : null}
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {progress.students.map((s) => (
          <li key={s.participantId} className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <StatusDot status={s.status} />
              <UserAvatar name={s.displayName} size={22} />
              {s.displayName}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              {s.answered}/{s.total}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "blue" | "yellow" | "gray";
}) {
  const cls = {
    green: "bg-success-light text-success",
    blue: "bg-primary-light text-primary",
    yellow: "bg-warn-light text-[#b45309]",
    gray: "bg-surface-3 text-muted-foreground",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 font-semibold ${cls}`}>
      {value} {label}
    </span>
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
  not_started: "bg-text-3",
  in_progress: "bg-primary",
  stuck: "bg-warning",
};

function StatusDot({ status }: { status: StudentProgressStatus }) {
  const label =
    status === "not_started" ? "не начал" : status === "stuck" ? "застрял" : "в работе";
  return (
    <span
      className={`inline-block size-2.5 shrink-0 rounded-full ${DOT_CLASS[status]}`}
      title={label}
      aria-label={label}
    />
  );
}
