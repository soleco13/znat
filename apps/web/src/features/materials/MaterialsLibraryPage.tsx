import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ListMaterialsQuery, MaterialStatus, MaterialSummary } from "@school/shared";
import { useAuthStore } from "../../shared/auth-store.js";
import { listMaterials, createMaterial } from "./materials-api.js";
import { MATERIAL_TEMPLATES, buildMaterialFromTemplate } from "./material-templates.js";

/**
 * Библиотека материалов (Э9.1, §7.2 ТЗ) — дерево предмет → класс → тема,
 * фильтры, поиск, статусы. Карточка ведёт в редактор (Э9.2, `/materials/:id/edit`)
 * — доступ туда всё равно перепроверяется сервером (`getMaterialForEdit`),
 * ссылка здесь не решение о правах. id материала по-прежнему показан и
 * копируется отдельной кнопкой — им пользуются `LessonActivityPanel`/
 * `HomeworkPage` (Э8.6/8.11), которые пока просят id материала руками.
 *
 * «Создать материал» (Э9.10, §7.1 ТЗ п.5 «методист не начинает с чистого
 * листа») — до этой подзадачи материалы заводились ИСКЛЮЧИТЕЛЬНО
 * `db/seed-material.ts` (ручной скрипт в обход API, стоп-лист Э8), первого
 * настоящего пути создания через продукт не было вовсе. `CreateMaterialForm`
 * ниже закрывает этот пробел: небольшая форма метаданных + выбор шаблона
 * (`material-templates.ts`) собирают валидный `Material` НА КЛИЕНТЕ, тем
 * же кодом, что и кнопка «Добавить блок» в редакторе (`block-factories.ts`)
 * — сервер (`POST /materials`) лишь сохраняет то, что уже прошло ту же
 * форму блоков, что и любая ручная правка.
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
  const [showCreateForm, setShowCreateForm] = useState(false);

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
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Библиотека материалов</h1>
        <button type="button" onClick={() => setShowCreateForm((v) => !v)} className="btn btn-primary btn-sm">
          {showCreateForm ? "Отмена" : "+ Создать материал"}
        </button>
      </div>

      {showCreateForm && <CreateMaterialForm onCancel={() => setShowCreateForm(false)} />}

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
        <p className="text-sm text-slate-500">Ничего не найдено. Попробуйте изменить фильтры или создайте новый материал.</p>
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

/**
 * Форма создания материала (Э9.10) — метаданные (заголовок/предмет/классы/
 * тема) + выбор шаблона. `grades` — свободный текст «8» или «8, 9», не
 * мультиселект: у школы нет фиксированного справочника классов в этом
 * приложении (фильтр библиотеки выше тоже свободный текст на один класс),
 * заводить отдельный источник правды под один текстовый инпут формы
 * создания было бы лишним.
 */
function CreateMaterialForm({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [gradesText, setGradesText] = useState("");
  const [topic, setTopic] = useState("");
  const [templateId, setTemplateId] = useState(MATERIAL_TEMPLATES[0]!.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function parseGrades(text: string): number[] {
    return [...new Set(text.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0))];
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const grades = parseGrades(gradesText);
    if (!title.trim() || !subject.trim() || grades.length === 0) {
      setError("Заполните заголовок, предмет и хотя бы один класс (число)");
      return;
    }
    const template = MATERIAL_TEMPLATES.find((t) => t.id === templateId) ?? MATERIAL_TEMPLATES[0]!;
    const content = buildMaterialFromTemplate(template, { title: title.trim(), subject: subject.trim(), grades, topic });
    setSubmitting(true);
    setError(null);
    try {
      const result = await createMaterial(content);
      navigate(`/materials/${result.materialId}/edit`);
    } catch {
      setError("Не удалось создать материал — попробуйте ещё раз");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 flex flex-col gap-3 rounded border p-3">
      <div className="flex flex-wrap gap-3">
        <label className="flex-1 text-xs text-slate-500">
          Заголовок
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 block w-full rounded border px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-500">
          Предмет
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="математика"
            className="mt-1 block rounded border px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-500">
          Классы
          <input
            value={gradesText}
            onChange={(e) => setGradesText(e.target.value)}
            placeholder="8 или 8, 9"
            className="mt-1 block w-24 rounded border px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-500">
          Тема (необязательно)
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="mt-1 block rounded border px-2 py-1 text-sm"
          />
        </label>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-slate-500">Шаблон</span>
        <div className="flex flex-col gap-1">
          {MATERIAL_TEMPLATES.map((t) => (
            <label key={t.id} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="template"
                checked={templateId === t.id}
                onChange={() => setTemplateId(t.id)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{t.label}</span>
                <span className="block text-xs text-slate-400">{t.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className="btn btn-primary btn-sm">
          {submitting ? "Создание…" : "Создать"}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
          Отмена
        </button>
      </div>
    </form>
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
      <Link to={`/materials/${material.id}/edit`} className="truncate hover:underline">
        {material.title} <span className="text-xs text-slate-400">({STATUS_LABEL[material.status]})</span>
      </Link>
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
