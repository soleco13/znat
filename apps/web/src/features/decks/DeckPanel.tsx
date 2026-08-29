import { useEffect, useMemo, useRef, useState } from "react";
import type { Deck, DeckProgressEvent, DeckUploadResponse } from "@school/shared";
import { apiFetch, ApiError } from "../../shared/api-client.js";

/**
 * Э4.4, §8.1 ТЗ: загрузка презентации и прогресс её конвертации («7 из 24»).
 * Панель компактная и временная — полноценная лента миниатюр и импорт слайдов
 * как страниц холста это Э4.6; здесь только статус задачи.
 *
 * Источник истины по статусу — WS-канал урока (`deck_status` в
 * `ServerRoomMessage`, прокидывается пропом `statuses` из `RoomPage`). При
 * входе в урок список подтягивается разово через `GET /lessons/:id/decks`,
 * дальше живёт на событиях.
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
  statuses,
}: {
  lessonId: string;
  isTeacher: boolean;
  statuses: Record<string, DeckProgressEvent>;
}) {
  const [decks, setDecks] = useState<Record<string, DeckView>>({});
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDecks({});
    apiFetch<{ decks: Deck[] }>(`/lessons/${lessonId}/decks`)
      .then((data) => {
        setDecks((prev) => {
          const next = { ...prev };
          for (const d of data.decks) next[d.id] ??= fromDeck(d);
          return next;
        });
      })
      .catch(() => undefined);
  }, [lessonId]);

  // Живые события статуса из WS перекрывают то, что пришло разовым GET.
  useEffect(() => {
    setDecks((prev) => {
      const next = { ...prev };
      for (const ev of Object.values(statuses)) next[ev.deckId] = ev;
      return next;
    });
  }, [statuses]);

  const ordered = useMemo(
    () => Object.values(decks).sort((a, b) => a.title.localeCompare(b.title, "ru")),
    [decks],
  );

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch<DeckUploadResponse>(`/lessons/${lessonId}/uploads`, {
        method: "POST",
        body: form,
      });
      // Оптимистично — WS-событие `deck_status` тут же придёт и уточнит.
      setDecks((prev) => ({
        ...prev,
        [res.deckId]: prev[res.deckId] ?? {
          deckId: res.deckId,
          title: file.name.replace(/\.[^.]+$/, ""),
          status: res.status,
          progress: 0,
          slideCount: 0,
          error: null,
        },
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить презентацию");
    } finally {
      setUploading(false);
    }
  }

  async function remove(deckId: string) {
    try {
      await apiFetch(`/lessons/${lessonId}/decks/${deckId}`, { method: "DELETE" });
      setDecks((prev) => {
        const next = { ...prev };
        delete next[deckId];
        return next;
      });
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
