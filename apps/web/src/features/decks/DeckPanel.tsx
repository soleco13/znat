import { useMemo, useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import type { Deck, DeckProgressEvent, DeckUploadResponse } from "@school/shared";

import { cn } from "@/lib/utils";
import { apiFetch, ApiError } from "@/shared/api-client";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

/**
 * Э4.4/Э4.6, §8.1 ТЗ: загрузка презентации и прогресс её конвертации.
 * `decks` — список презентаций урока, `statuses` — живые события `deck_status`.
 */

const ACCEPT =
  ".pptx,.odp,.docx,.pdf," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation," +
  "application/vnd.oasis.opendocument.presentation," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/pdf";

type DeckView = Pick<
  DeckProgressEvent,
  "deckId" | "title" | "status" | "progress" | "slideCount" | "error"
>;

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
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h2 className="ds-label">Презентации ({ordered.length})</h2>
        {isTeacher ? (
          <Button asChild variant="outline" size="sm" loading={uploading} className="cursor-pointer">
            <label>
              <Upload aria-hidden />
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
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {isTeacher && ordered.some((d) => d.status === "ready") ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Импорт слайдов на холст и лента миниатюр — на панели доски выше.
        </p>
      ) : null}

      <ul className="mt-3 flex flex-col gap-2">
        {ordered.map((d) => (
          <li key={d.deckId} className="rounded-md border border-border px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground">{d.title}</span>
              {isTeacher ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => remove(d.deckId)}
                  aria-label="Удалить презентацию"
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
            <div
              className={cn(
                "text-xs",
                d.status === "failed"
                  ? "text-destructive"
                  : d.status === "ready"
                    ? "text-success"
                    : "text-muted-foreground",
              )}
            >
              {statusLabel(d)}
            </div>
            {d.status === "converting" && d.slideCount > 0 ? (
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-pill bg-surface-3">
                <div
                  className="h-full bg-primary transition-all duration-500 ease-ds"
                  style={{ width: `${Math.round((d.progress / d.slideCount) * 100)}%` }}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
