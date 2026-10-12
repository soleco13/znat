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
import { formatBytes, formatDate, formatDuration } from "./format.js";
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

/** Сколько после старта нельзя нажать «Остановить» (защита от двойного клика). */
const STOP_LOCK_MS = 5000;

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
  // Школе разрешена экспериментальная запись — в диалоге есть «Тестовая запись».
  const [experimentalAvailable, setExperimentalAvailable] = useState(false);
  const [busyMode, setBusyMode] = useState<"normal" | "test" | null>(null);
  // «Остановить» появляется на месте «Начать запись»: повторный клик сразу
  // после старта останавливал запись за секунду (2026-10-12, дважды) — Egress
  // при этом прерывается без файла. Первые секунды кнопка неактивна.
  const [stopLockedUntil, setStopLockedUntil] = useState(0);
  const [, forceTick] = useState(0);

  const disabledRef = useRef(false);
  disabledRef.current = disabled;

  const refresh = useCallback(async () => {
    if (disabledRef.current) return;
    try {
      const res = await getLessonRecordings(lessonId);
      setRecordings(res.recordings);
      setActiveId(res.active?.id ?? null);
      setExperimentalAvailable(res.experimentalAvailable === true);
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

  async function handleStart(test = false) {
    setBusy(true);
    setBusyMode(test ? "test" : "normal");
    setError(null);
    try {
      const rec = await startLessonRecording(lessonId, { test });
      setStopLockedUntil(Date.now() + STOP_LOCK_MS);
      setTimeout(() => forceTick((n) => n + 1), STOP_LOCK_MS + 50);
      setActiveId(rec.id);
      onActiveChange(true);
      setConfirming(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        setDisabled(true);
      } else if (e instanceof ApiError && e.status === 403) {
        setError(e.message);
      } else {
        setError("Не удалось начать запись");
      }
    } finally {
      setBusy(false);
      setBusyMode(null);
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
              <Circle className="size-2 fill-current" aria-hidden /> идёт
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
            Запись урока пока недоступна — сервис записи не подключён.
          </p>
        ) : recordingActive ? (
          <Button
            key="stop"
            variant="destructive"
            size="sm"
            onClick={handleStop}
            loading={busy}
            disabled={Date.now() < stopLockedUntil}
          >
            {busy ? "Останавливаем…" : Date.now() < stopLockedUntil ? "Запись запускается…" : "Остановить запись"}
          </Button>
        ) : (
          <Button key="start" variant="outline" size="sm" onClick={() => setConfirming(true)}>
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
                {r.method === "experimental" ? <Badge variant="blue">эксперимент</Badge> : null}{" "}
                · {formatDuration(r.durationSec)} · {formatBytes(r.sizeBytes)}
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
            {experimentalAvailable ? (
              <p className="text-sm text-muted-foreground">
                «Тестовая запись» — запись новым способом вместо обычной. В списке записей она
                помечена «эксперимент», файл появится после обработки.
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            {experimentalAvailable ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void handleStart(true)}
              >
                {busyMode === "test" ? "Запускаем…" : "Тестовая запись"}
              </Button>
            ) : null}
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void handleStart();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busyMode === "normal" ? "Запускаем…" : "Да, начать запись"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
