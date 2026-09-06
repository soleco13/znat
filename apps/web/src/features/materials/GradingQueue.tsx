import { useEffect, useState } from "react";
import type { GradingQueueItem } from "@school/shared";

import { sanitizeHtml } from "@/shared/sanitize-html";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { EmptyState } from "@/shared/ui/empty-state";
import { Input } from "@/shared/ui/input";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { Textarea } from "@/shared/ui/textarea";
import { CheckCircle2 } from "lucide-react";
import { getGradingQueue, gradeManualResponse } from "./activity-api.js";

/**
 * Очередь ручной проверки (Э8.12, §6.4/§8 ТЗ). Показывает сданные,
 * ещё не оценённые ответы `open_answer`. После отправки карточка убирается
 * из списка оптимистично.
 */
export function GradingQueue() {
  const [items, setItems] = useState<GradingQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await getGradingQueue();
      setItems(data.items);
      setError(null);
    } catch {
      setError("Не удалось загрузить очередь проверки");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (!items) return <CenteredSpinner label="Загрузка очереди…" />;
  if (items.length === 0)
    return (
      <EmptyState icon={CheckCircle2} title="Очередь пуста" description="Все ответы проверены" />
    );

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <GradingCard
          key={item.responseId}
          item={item}
          onGraded={() =>
            setItems((prev) => prev?.filter((i) => i.responseId !== item.responseId) ?? null)
          }
        />
      ))}
    </div>
  );
}

function GradingCard({ item, onGraded }: { item: GradingQueueItem; onGraded: () => void }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [score, setScore] = useState(() => sumChecked(item.rubric, {}));
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleCriterion(id: string) {
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      setScore(sumChecked(item.rubric, next));
      return next;
    });
  }

  async function handleGrade() {
    if (score < 0 || score > item.maxScore) {
      setError(`Балл должен быть от 0 до ${item.maxScore}`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await gradeManualResponse(item.responseId, {
        score,
        rubricScores: checked,
        comment: comment.trim() || undefined,
      });
      onGraded();
    } catch {
      setError("Не удалось сохранить оценку");
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <header className="text-xs text-muted-foreground">
        {item.materialTitle} · {item.participantName} · сдано{" "}
        {new Date(item.submittedAt).toLocaleString("ru-RU")}
      </header>
      <div
        className="prose text-sm font-semibold"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.promptHtml) }}
      />
      <p className="whitespace-pre-wrap rounded-md bg-secondary p-3 text-sm">
        {item.response.text || "(нет ответа)"}
      </p>

      <ul className="space-y-1.5">
        {item.rubric.map((c) => (
          <li key={c.id}>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={checked[c.id] ?? false}
                onCheckedChange={() => toggleCriterion(c.id)}
              />
              {c.label} <span className="text-xs text-muted-foreground">({c.points})</span>
            </label>
          </li>
        ))}
      </ul>

      <label className="flex items-center gap-2 text-sm">
        Балл:
        <Input
          type="number"
          min={0}
          max={item.maxScore}
          step="0.5"
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          className="h-8 w-20"
        />
        / {item.maxScore}
      </label>

      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Комментарий (необязательно)"
        rows={2}
      />

      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
      <Button size="sm" onClick={handleGrade} loading={saving}>
        {saving ? "Сохраняем…" : "Поставить оценку"}
      </Button>
    </section>
  );
}

/** Сумма баллов отмеченных критериев — стартовое значение поля «Балл». */
function sumChecked(rubric: GradingQueueItem["rubric"], checked: Record<string, boolean>): number {
  return rubric.reduce((sum, c) => sum + (checked[c.id] ? c.points : 0), 0);
}
