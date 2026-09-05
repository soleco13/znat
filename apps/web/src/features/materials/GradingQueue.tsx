import { useEffect, useState } from "react";
import type { GradingQueueItem } from "@school/shared";
import { sanitizeHtml } from "../../shared/sanitize-html.js";
import { getGradingQueue, gradeManualResponse } from "./activity-api.js";

/**
 * Очередь ручной проверки (Э8.12, §6.4/§8 ТЗ: «попадает в очередь учителя с
 * рубрикой»). Показывает только сданные (не черновики), ещё не оценённые
 * ответы `open_answer` — сервер (`GET /grading/queue`) уже отфильтровал по
 * владению заданием (`assignedBy`), фронт ничего не решает сам.
 *
 * Каждая карточка — свой независимый черновик оценки (баллы, критерии
 * рубрики, комментарий) до нажатия «Поставить оценку»; после успешной
 * отправки карточка убирается из списка ОПТИМИСТИЧНО (сервер — источник
 * правды при следующей полной перезагрузке очереди, не при каждой отдельной
 * оценке — тот же компромисс, что у `ClassProgressPanel`/`QuestionAnalyticsPanel`,
 * которые тоже не пушат, а перечитывают целиком).
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

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!items) return <p className="text-xs text-slate-400">Загрузка очереди…</p>;
  if (items.length === 0) return <p className="text-xs text-slate-400">Очередь пуста — все ответы проверены</p>;

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <GradingCard
          key={item.responseId}
          item={item}
          onGraded={() => setItems((prev) => prev?.filter((i) => i.responseId !== item.responseId) ?? null)}
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
    <section className="space-y-3 rounded border p-3">
      <header className="text-xs text-slate-400">
        {item.materialTitle} · {item.studentName} · сдано {new Date(item.submittedAt).toLocaleString()}
      </header>
      <div className="prose text-sm font-medium" dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.promptHtml) }} />
      <p className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-sm">{item.response.text || "(нет ответа)"}</p>

      <ul className="space-y-1">
        {item.rubric.map((c) => (
          <li key={c.id}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={checked[c.id] ?? false} onChange={() => toggleCriterion(c.id)} />
              {c.label} <span className="text-xs text-slate-400">({c.points})</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          Балл:
          <input
            type="number"
            min={0}
            max={item.maxScore}
            step="0.5"
            value={score}
            onChange={(e) => setScore(Number(e.target.value))}
            className="w-16 rounded border px-1 py-0.5"
          />
          / {item.maxScore}
        </label>
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Комментарий (необязательно)"
        className="w-full rounded border px-2 py-1 text-sm"
        rows={2}
      />

      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        onClick={handleGrade}
        disabled={saving}
        className="rounded border bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-40"
      >
        {saving ? "Сохраняем…" : "Поставить оценку"}
      </button>
    </section>
  );
}

/** Сумма баллов отмеченных критериев — стартовое значение поля «Балл», учитель может изменить вручную (§6.4 ТЗ: рубрика ориентир, не жёсткая формула). */
function sumChecked(rubric: GradingQueueItem["rubric"], checked: Record<string, boolean>): number {
  return rubric.reduce((sum, c) => sum + (checked[c.id] ? c.points : 0), 0);
}
