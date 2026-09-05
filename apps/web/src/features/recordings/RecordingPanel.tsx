import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordingStatus, RecordingWithDownload } from "@school/shared";
import { ApiError } from "../../shared/api-client.js";
import {
  getLessonRecordings,
  startLessonRecording,
  stopLessonRecording,
} from "./recordings-api.js";

/**
 * Э10.3/10.4 — управление записью урока и список готовых файлов, только
 * для учителя урока/админа. Ученик этот компонент не видит вовсе (не
 * рендерится в `RoomPage`), а о факте записи узнаёт по баннеру согласия
 * `RecordingConsentBanner` ниже, который слушает WS `recording_status`.
 *
 * Свежесть: активную запись ведём от WS (`recordingActive` проп из
 * `RoomPage`) — мгновенно; список готовых файлов подтягиваем опросом раз
 * в 20 с и после каждой смены `recordingActive` (файл финализируется
 * асинхронно после «Стоп»).
 */

const STATUS_LABEL: Record<RecordingStatus, string> = {
  starting: "запускается",
  recording: "идёт запись",
  processing: "обрабатывается",
  ready: "готова",
  failed: "сбой",
  aborted: "прервана",
  deleted: "удалена по сроку хранения",
};

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
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
  /** Идёт ли запись прямо сейчас — от WS `recording_status` в `RoomPage`. */
  recordingActive: boolean;
  /** Сообщить `RoomPage` о смене состояния по действию учителя (до прихода WS-сигнала). */
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
    if (disabledRef.current) return; // 503 — вторая машина не подключена, не долбим эндпоинт
    try {
      const res = await getLessonRecordings(lessonId);
      setRecordings(res.recordings);
      setActiveId(res.active?.id ?? null);
      onActiveChange(res.active != null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) setDisabled(true);
      // прочие ошибки не шумят в интерфейсе урока — список просто не обновится
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
    <div className="rounded border p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-600">
          Запись урока
          {recordingActive && <span className="ml-2 text-red-600">● идёт</span>}
        </h2>
        <button onClick={() => setExpanded((v) => !v)} className="text-xs text-slate-400">
          {expanded ? "Свернуть" : `Записи (${recordings.length})`}
        </button>
      </div>

      {disabled ? (
        <p className="text-xs text-slate-400">
          Запись пока недоступна: вторая машина с egress не подключена (§10.4 ТЗ).
        </p>
      ) : recordingActive ? (
        <button
          onClick={handleStop}
          disabled={busy}
          className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 disabled:opacity-40"
        >
          {busy ? "Останавливаем…" : "Остановить запись"}
        </button>
      ) : confirming ? (
        <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs">
          <span>
            Все участники урока, включая учеников, увидят баннер «Идёт запись урока» (152-ФЗ).
            Начать запись?
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleStart}
              disabled={busy}
              className="rounded border border-red-300 px-3 py-1 text-red-700 disabled:opacity-40"
            >
              {busy ? "Запускаем…" : "Да, начать запись"}
            </button>
            <button onClick={() => setConfirming(false)} className="rounded border px-3 py-1">
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} className="rounded border px-3 py-1 text-sm">
          Начать запись
        </button>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {expanded && (
        <ul className="mt-3 flex flex-col gap-1 text-xs">
          {recordings.length === 0 && <li className="text-slate-400">Записей ещё нет</li>}
          {recordings.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded border px-2 py-1">
              <span className="text-slate-600">
                {formatDate(r.startedAt)} · {STATUS_LABEL[r.status]} · {formatDuration(r.durationSec)} ·{" "}
                {formatSize(r.sizeBytes)}
                {r.expiresAt && (
                  <span className="text-slate-400"> · хранится до {formatDate(r.expiresAt)}</span>
                )}
              </span>
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border px-2 py-0.5 text-slate-700"
                >
                  Скачать
                </a>
              ) : (
                <span className="text-slate-300">—</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Баннер согласия на запись (Э10.3, §7.9/§10.10 ТЗ, 152-ФЗ). Видят ВСЕ
 * участники урока — и учитель, и ученики. Управляется WS-сигналом
 * `recording_status` из `RoomPage` (шлётся при старте/остановке и при
 * входе в уже идущий урок).
 */
export function RecordingConsentBanner({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-800"
    >
      <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
      Идёт запись урока
    </div>
  );
}
