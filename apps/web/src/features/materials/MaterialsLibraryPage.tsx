import { useEffect, useMemo, useState } from "react";
import type { ListMaterialsQuery, MaterialStatus, MaterialSummary } from "@school/shared";
import { useAuthStore } from "../../shared/auth-store.js";
import { listMaterials } from "./materials-api.js";

/**
 * Библиотека материалов (Э9.1, §7.2 ТЗ) — дерево предмет → класс → тема,
 * фильтры, поиск, статусы. Редактора материалов ещё нет (Э9.2+), поэтому
 * карточка не открывает ничего — только показывает id материала для ручной
 * выдачи, тем же способом «id материала» что уже используют
 * `LessonActivityPanel`/`HomeworkPage` (Э8.6/8.11).
 */
const STATUS_LABEL: Record<MaterialStatus, string> = {
  draft: "Черновик",
  review: "На ревью",
  published: "Опубликован",
};

const NO_TOPIC = "__no_topic__";

export function MaterialsLibraryPage() {
  const user = useAuthStore((s) => s.user);
  if (user && user.role === "student") {
    return (
      <div className="mx-auto mt-12 max-w-2xl px-4">
        <p className="text-slate-500">Библиотека материалов недоступна для роли «ученик».</p>
      </div>
    );
  }
  return <MaterialsLibraryContent />;
}

function MaterialsLibraryContent() {
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState<MaterialStatus | "">("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<MaterialSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo<ListMaterialsQuery>(
    () => ({
      subject: subject.trim() || undefined,
      grade: grade.trim() ? Number(grade.trim()) : undefined,
      topic: topic.trim() || undefined,
      status: status || undefined,
      q: q.trim() || undefined,
    }),
    [subject, grade, topic, status, q],
  );

  useEffect(() => {
    let cancelled = false;
    listMaterials(query)
      .then((data) => !cancelled && setItems(data.items))
      .catch(() => !cancelled && setError("Не удалось загрузить библиотеку материалов"));
    return () => {
      cancelled = true;
    };
  }, [query]);

  const tree = useMemo(() => buildTree(items ?? []), [items]);

  return (
    <div className="mx-auto mt-8 max-w-4xl px-4">
      <h1 className="mb-4 text-xl font-semibold">Библиотека материалов</h1>

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">
          Предмет
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="математика"
            className="block rounded border px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-500">
          Класс
          <input
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            placeholder="8"
            inputMode="numeric"
            className="block w-16 rounded border px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-500">
          Тема
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="block rounded border px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-500">
          Статус
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as MaterialStatus | "")}
            className="block rounded border px-2 py-1 text-sm"
          >
            <option value="">Любой</option>
            {(Object.keys(STATUS_LABEL) as MaterialStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1 text-xs text-slate-500">
          Поиск по названию
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="block w-full rounded border px-2 py-1 text-sm"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && !items && <p className="text-sm text-slate-400">Загрузка…</p>}
      {!error && items && items.length === 0 && (
        <p className="text-sm text-slate-500">Ничего не найдено. Материалы заводятся seed-скриптом (Э9.2 — редактор).</p>
      )}

      <div className="flex flex-col gap-4">
        {[...tree.entries()].map(([subj, grades]) => (
          <div key={subj}>
            <h2 className="text-sm font-semibold text-slate-700">{subj}</h2>
            {[...grades.entries()].map(([gr, topics]) => (
              <div key={gr} className="ml-3 mt-1">
                <h3 className="text-xs font-medium text-slate-500">{gr} класс</h3>
                {[...topics.entries()].map(([tp, materials]) => (
                  <div key={tp} className="ml-3 mt-1">
                    <h4 className="text-xs text-slate-400">{tp === NO_TOPIC ? "Без темы" : tp}</h4>
                    <ul className="ml-3 flex flex-col gap-1">
                      {materials.map((m) => (
                        <MaterialRow key={m.id} material={m} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MaterialRow({ material }: { material: MaterialSummary }) {
  const [copied, setCopied] = useState(false);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(material.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // буфер обмена недоступен — не критично, id всё равно показан текстом
    }
  }

  return (
    <li className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-sm">
      <span className="truncate">
        {material.title}{" "}
        <span className="text-xs text-slate-400">({STATUS_LABEL[material.status]})</span>
      </span>
      <button onClick={copyId} className="shrink-0 text-xs text-slate-500 underline">
        {copied ? "id скопирован" : `id ${material.id.slice(0, 8)}…`}
      </button>
    </li>
  );
}

function buildTree(items: MaterialSummary[]): Map<string, Map<number, Map<string, MaterialSummary[]>>> {
  const tree = new Map<string, Map<number, Map<string, MaterialSummary[]>>>();
  for (const item of items) {
    const grades = item.grades.length > 0 ? item.grades : [];
    for (const grade of grades) {
      const topicKey = item.topic ?? NO_TOPIC;
      const bySubject = tree.get(item.subject) ?? new Map();
      tree.set(item.subject, bySubject);
      const byGrade = bySubject.get(grade) ?? new Map();
      bySubject.set(grade, byGrade);
      const byTopic = byGrade.get(topicKey) ?? [];
      byTopic.push(item);
      byGrade.set(topicKey, byTopic);
    }
  }
  return tree;
}
