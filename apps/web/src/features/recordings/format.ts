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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Сколько целых дней осталось до удаления по ретеншну; `null`, если срока нет. */
export function daysLeft(expiresAt: string | null, now = Date.now()): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / DAY_MS));
}

/** «Пт, 26 сент. · 14:00» — дата записи в карточках. */
export function formatRecordingDate(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${day[0]!.toUpperCase()}${day.slice(1)} · ${time}`;
}

function startOfWeek(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.getTime();
}

/** Группа в архиве записей: «Эта неделя», «Прошлая неделя», дальше — месяц. */
export function recordingGroupLabel(iso: string, now = new Date()): string {
  const t = new Date(iso).getTime();
  const week = startOfWeek(now);
  if (t >= week) return "Эта неделя";
  if (t >= week - 7 * DAY_MS) return "Прошлая неделя";
  const label = new Date(iso).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return label[0]!.toUpperCase() + label.slice(1).replace(" г.", "");
}
