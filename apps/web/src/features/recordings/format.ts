import type { RecordingStatus } from "@school/shared";

/** Форматирование для карточек/таблиц записей — общее для списка, панели урока и страницы просмотра. */

export const STATUS_LABEL: Record<RecordingStatus, string> = {
  starting: "запускается",
  recording: "идёт запись",
  processing: "обрабатывается",
  ready: "готова",
  failed: "сбой",
  aborted: "прервана",
  deleted: "удалена",
};

export const STATUS_VARIANT: Record<RecordingStatus, "blue" | "green" | "yellow" | "red" | "gray"> = {
  starting: "yellow",
  recording: "red",
  processing: "yellow",
  ready: "green",
  failed: "red",
  aborted: "gray",
  deleted: "gray",
};

/** Статусы, для которых удаление в принципе возможно (см. `adminDeleteRecording` на бэке). */
export function isDeletable(status: RecordingStatus): boolean {
  return status !== "deleted" && status !== "starting" && status !== "recording";
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} ГБ`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} МБ`;
}

export function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}
