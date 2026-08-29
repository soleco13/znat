import { useMemo, useRef, useState } from "react";
import type { Deck, DeckProgressEvent, DeckUploadResponse } from "@school/shared";
import { apiFetch, ApiError } from "../../shared/api-client.js";

/**
 * Э4.4/Э4.6, §8.1 ТЗ: загрузка презентации и прогресс её конвертации («7 из
 * 24»). Импорт слайдов как страниц холста и лента миниатюр — в доске
 * (`features/canvas/Board.tsx`), эта панель отвечает только за исходники.
 *
 * Данные приходят сверху из `RoomPage`: `decks` — список презентаций урока
 * (со слайдами, обновляется по `onChanged`), `statuses` — живые события
 * `deck_status` из WS-канала урока. Прогресс из `statuses` перекрывает
 * базовое состояние из `decks`.
 */

const ACCEPT =
  ".pptx,.odp,.docx,.pdf," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation," +
  "application/vnd.oasis.opendocument.presentation," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/pdf";

type DeckView = Pick<DeckProgressEvent, "deckId" | "title" | "status" | "progress" | "slideCount" | "error">;

function fromDeck(d: Deck): DeckView {
  return {
    deckId: d.id,
    title: d.title,
    status: d.status,
    progress: d.progress,
    slideCount: d.slideCount,
    error: d.error,
  };
}

function statusLabel(d: DeckView): string {
  switch (d.status) {
    case "pending":
      return "В очереди на конвертацию…";
    case "converting":
      return d.slideCount > 0 ? `Конвертация: ${d.progress} из ${d.slideCount}` : "Конвертация…";
    case "ready":
      return `Готово · ${d.slideCount} ${plural(d.slideCount, "слайд", "слайда", "слайдов")}`;
    case "failed":
      return `Ошибка: ${d.error ?? "не удалось сконвертировать"}`;
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function DeckPanel({
  lessonId,
  isTeacher,
  decks,
  statuses,
  onChanged,
}: {
  lessonId: string;
  isTeacher: boolean;
  decks: Deck[];
  statuses: Record<string, DeckProgressEvent>;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ordered = useMemo(() => {
    const byId = new Map<string, DeckView>();
    for (const d of decks) byId.set(d.id, fromDeck(d));
    // Живые события перекрывают базовое состояние и добавляют только что
    // загруженные презентации, которых ещё нет в `decks`.
    for (const ev of Object.values(statuses)) byId.set(ev.deckId, ev);
    return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title, "ru"));
  }, [decks, statuses]);

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await apiFetch<DeckUploadResponse>(`/lessons/${lessonId}/uploads`, {
        method: "POST",
        body: form,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить презентацию");
    } finally {
      setUploading(false);
    }
  }

  async function remove(deckId: string) {
    try {
      await apiFetch(`/lessons/${lessonId}/decks/${deckId}`, { method: "DELETE" });
      onChanged();
    } catch {
      setError("Не удалось удалить презентацию");
    }
  }

  if (!isTeacher && ordered.length === 0) return null;

  return (
    <div className="rounded border p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-600">Презентации ({ordered.length})</h2>
        {isTeacher && (
          <label className="cursor-pointer rounded border px-3 py-1 text-sm">
            {uploading ? "Загрузка…" : "Загрузить .pptx / .pdf"}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {isTeacher && ordered.some((d) => d.status === "ready") && (
        <p className="mb-2 text-xs text-slate-500">
          Импорт слайдов на холст и лента миниатюр — на панели доски выше.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {ordered.map((d) => (
          <li key={d.deckId} className="rounded border px-2 py-1.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{d.title}</span>
              {isTeacher && (
                <button
                  onClick={() => remove(d.deckId)}
                  className="rounded border px-2 py-0.5 text-xs text-red-700"
                >
                  Удалить
                </button>
              )}
            </div>
            <div
              className={
                d.status === "failed"
                  ? "text-xs text-red-700"
                  : d.status === "ready"
                    ? "text-xs text-green-700"
                    : "text-xs text-slate-500"
              }
            >
              {statusLabel(d)}
            </div>
            {d.status === "converting" && d.slideCount > 0 && (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-slate-200">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${Math.round((d.progress / d.slideCount) * 100)}%` }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
