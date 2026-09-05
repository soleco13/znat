import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Circle, Download, Disc } from "lucide-react";
import type { RecordingStatus, RecordingWithDownload } from "@school/shared";

import { cn } from "@/lib/utils";
import { ApiError } from "@/shared/api-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import {
  getLessonRecordings,
  startLessonRecording,
  stopLessonRecording,
} from "./recordings-api.js";

const STATUS_LABEL: Record<RecordingStatus, string> = {
  starting: "запускается",
  recording: "идёт запись",
  processing: "обрабатывается",
  ready: "готова",
  failed: "сбой",
  aborted: "прервана",
  deleted: "удалена по сроку хранения",
};

const STATUS_VARIANT: Record<RecordingStatus, "blue" | "green" | "yellow" | "red" | "gray"> = {
  starting: "yellow",
  recording: "red",
  processing: "yellow",
  ready: "green",
  failed: "red",
  aborted: "gray",
  deleted: "gray",
};

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} ГБ` : `${mb.toFixed(0)} МБ`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export function RecordingPanel({
  lessonId,
  recordingActive,
  onActiveChange,
}: {
  lessonId: string;
  recordingActive: boolean;
  onActiveChange: (active: boolean) => void;
}) {
  const [recordings, setRecordings] = useState<RecordingWithDownload[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false); // RECORDING_ENABLED=false → 503

  const disabledRef = useRef(false);
  disabledRef.current = disabled;

  const refresh = useCallback(async () => {
    if (disabledRef.current) return;
    try {
      const res = await getLessonRecordings(lessonId);
      setRecordings(res.recordings);
      setActiveId(res.active?.id ?? null);
      onActiveChange(res.active != null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) setDisabled(true);
    }
  }, [lessonId, onActiveChange]);

  useEffect(() => {
    void refresh();
  }, [refresh, recordingActive]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const t = setInterval(() => void refreshRef.current(), 20_000);
    return () => clearInterval(t);
  }, []);

  async function handleStart() {
    setBusy(true);
    setError(null);
    try {
      const rec = await startLessonRecording(lessonId);
      setActiveId(rec.id);
      onActiveChange(true);
      setConfirming(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        setDisabled(true);
      } else {
        setError("Не удалось начать запись");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    if (!activeId) return;
    setBusy(true);
    setError(null);
    try {
      await stopLessonRecording(lessonId, activeId);
      onActiveChange(false);
      setActiveId(null);
      void refresh();
    } catch {
      setError("Не удалось остановить запись");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h2 className="ds-label flex items-center gap-2">
          <Disc className="size-3.5" aria-hidden /> Запись урока
          {recordingActive ? (
            <Badge variant="red">
              <Circle className="size-2 animate-pulse fill-current" aria-hidden /> идёт
            </Badge>
          ) : null}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
          Записи ({recordings.length})
          <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} aria-hidden />
        </Button>
      </div>

      <div className="mt-3">
        {disabled ? (
          <p className="text-sm text-muted-foreground">
            Запись пока недоступна: вторая машина с egress не подключена (§10.4 ТЗ).
          </p>
        ) : recordingActive ? (
          <Button variant="destructive" size="sm" onClick={handleStop} loading={busy}>
            {busy ? "Останавливаем…" : "Остановить запись"}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            <Circle className="fill-destructive text-destructive" aria-hidden />
            Начать запись
          </Button>
        )}
      </div>

      {error ? <p className="mt-2 text-sm font-medium text-destructive">{error}</p> : null}

      {expanded ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {recordings.length === 0 ? (
            <li className="text-sm text-muted-foreground">Записей ещё нет</li>
          ) : null}
          {recordings.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className="min-w-0 text-muted-foreground">
                <span className="text-foreground">{formatDate(r.startedAt)}</span>{" "}
                <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>{" "}
                · {formatDuration(r.durationSec)} · {formatSize(r.sizeBytes)}
                {r.expiresAt ? (
                  <span className="text-text-3"> · хранится до {formatDate(r.expiresAt)}</span>
                ) : null}
              </span>
              {r.url ? (
                <Button asChild variant="outline" size="sm" className="shrink-0">
                  <a href={r.url} target="_blank" rel="noreferrer">
                    <Download aria-hidden />
                    Скачать
                  </a>
                </Button>
              ) : (
                <span className="text-text-3">—</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Э10.4: двухшаговое подтверждение старта (152-ФЗ). */}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Начать запись урока?</AlertDialogTitle>
            <AlertDialogDescription>
              Все участники урока, включая учеников, увидят баннер «Идёт запись урока» (152-ФЗ).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleStart();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Запускаем…" : "Да, начать запись"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/**
 * Баннер согласия на запись (Э10.3, §7.9/§10.10 ТЗ, 152-ФЗ). Видят ВСЕ участники.
 */
export function RecordingConsentBanner({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm font-semibold text-destructive"
    >
      <span className="inline-block size-2.5 animate-pulse rounded-full bg-destructive" />
      Идёт запись урока
    </div>
  );
}
