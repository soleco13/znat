import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ActivityProgress, StudentProgress, StudentProgressStatus } from "@school/shared";

import { UserAvatar } from "@/shared/ui/avatar";
import { Badge } from "@/shared/ui/badge";
import { CenteredSpinner } from "@/shared/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { getActivityProgress } from "./activity-api.js";

/** Как часто учитель опрашивает прогресс класса — «живая картина» без пуша (§7.3 ТЗ). */
const POLL_MS = 4_000;

/**
 * Панель прогресса класса по заданию (Э8.8, §7.3 ТЗ). Опрос
 * `GET /activities/:id/progress`, не пуш.
 */
export function ClassProgressPanel({
  activityId,
  onSelectStudent,
}: {
  activityId: string;
  /** Э12.5/§7.3: клик по ученику — открыть его попытку (учителю на уроке). */
  onSelectStudent?: (participantId: string, displayName: string) => void;
}) {
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

  const clickable = Boolean(onSelectStudent);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Stat label="ответили" value={counts.done} tone="green" />
        <Stat label="в работе" value={counts.in_progress} tone="blue" />
        <Stat label="застряли" value={counts.stuck} tone="yellow" />
        <Stat label="не начали" value={counts.not_started} tone="gray" />
        {error ? <span className="self-center text-warning">обновление прервалось</span> : null}
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ученик</TableHead>
              <TableHead className="w-28">Статус</TableHead>
              <TableHead className="w-20 text-right">Ответы</TableHead>
              {clickable ? <TableHead className="w-8" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {progress.students.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={clickable ? 4 : 3}
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  Учеников на уроке пока нет
                </TableCell>
              </TableRow>
            ) : (
              progress.students.map((s) => (
                <TableRow
                  key={s.participantId}
                  onClick={onSelectStudent ? () => onSelectStudent(s.participantId, s.displayName) : undefined}
                  className={clickable ? "cursor-pointer" : undefined}
                >
                  <TableCell>
                    <span className="flex items-center gap-2 font-medium">
                      <UserAvatar name={s.displayName} size={24} />
                      {s.displayName}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
                  </TableCell>
                  <TableCell className="text-right text-xs font-medium text-muted-foreground">
                    {s.answered}/{s.total}
                  </TableCell>
                  {clickable ? (
                    <TableCell className="text-muted-foreground">
                      <ChevronRight className="size-4" aria-hidden />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
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
    yellow: "bg-warn-light text-warn",
    gray: "bg-surface-3 text-muted-foreground",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 font-semibold ${cls}`}>
      {value} {label}
    </span>
  );
}

const STATUS_BADGE: Record<StudentProgressStatus, { label: string; variant: "gray" | "blue" | "yellow" }> = {
  not_started: { label: "не начал", variant: "gray" },
  in_progress: { label: "в работе", variant: "blue" },
  stuck: { label: "застрял", variant: "yellow" },
};

function StatusBadge({ status }: { status: StudentProgressStatus }) {
  const meta = STATUS_BADGE[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

function tally(students: StudentProgress[]) {
  const counts = { not_started: 0, in_progress: 0, stuck: 0, done: 0 };
  for (const s of students) {
    if (s.status === "in_progress" && s.total > 0 && s.answered >= s.total) counts.done += 1;
    else counts[s.status] += 1;
  }
  return counts;
}
