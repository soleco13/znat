import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Copy, FileText, Library, Plus, X } from "lucide-react";
import type { ListMaterialsQuery, MaterialStatus, MaterialSummary } from "@school/shared";

import { useAuthStore } from "@/shared/auth-store";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { ErrorState } from "@/shared/ui/error-state";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { PageHeader } from "@/shared/ui/page-header";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/sonner";
import { listMaterials, createMaterial } from "./materials-api.js";
import { MATERIAL_TEMPLATES, buildMaterialFromTemplate } from "./material-templates.js";

const STATUS_LABEL: Record<MaterialStatus, string> = {
  draft: "Черновик",
  review: "На ревью",
  published: "Опубликован",
};
const STATUS_VARIANT: Record<MaterialStatus, "gray" | "yellow" | "green"> = {
  draft: "gray",
  review: "yellow",
  published: "green",
};

const NO_TOPIC = "__no_topic__";
const ANY_STATUS = "__any__";

export function MaterialsLibraryPage() {
  const user = useAuthStore((s) => s.user);
  if (user && user.role === "student") {
    return (
      <div>
        <PageHeader title="Библиотека материалов" />
        <EmptyState icon={Library} title="Недоступно для роли «ученик»" />
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
    setItems(null);
    setError(null);
    listMaterials(query)
      .then((data) => !cancelled && setItems(data.items))
      .catch(() => !cancelled && setError("Не удалось загрузить библиотеку материалов"));
    return () => {
      cancelled = true;
    };
  }, [query]);

  const tree = useMemo(() => buildTree(items ?? []), [items]);
  const hasFilters = Boolean(subject || grade || topic || status || q);

  return (
    <div>
      <PageHeader
        title="Библиотека материалов"
        subtitle="Дерево предмет → класс → тема, поиск и статусы"
        actions={
          <Button
            variant={showCreateForm ? "ghost" : "default"}
            size="sm"
            onClick={() => setShowCreateForm((v) => !v)}
          >
            {showCreateForm ? <X aria-hidden /> : <Plus aria-hidden />}
            {showCreateForm ? "Отмена" : "Создать материал"}
          </Button>
        }
      />

      {showCreateForm ? <CreateMaterialForm onCancel={() => setShowCreateForm(false)} /> : null}

      <Card className="mb-6 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Предмет">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="математика" />
          </Field>
          <Field label="Класс">
            <Input
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder="8"
              inputMode="numeric"
            />
          </Field>
          <Field label="Тема">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} />
          </Field>
          <Field label="Статус">
            <Select
              value={status || ANY_STATUS}
              onValueChange={(v) => setStatus(v === ANY_STATUS ? "" : (v as MaterialStatus))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_STATUS}>Любой</SelectItem>
                {(Object.keys(STATUS_LABEL) as MaterialStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <Field label="Поиск по названию">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название материала" />
            </Field>
          </div>
        </div>
      </Card>

      {error ? (
        <ErrorState description={error} />
      ) : !items ? (
        <TreeSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Ничего не найдено"
          description={
            hasFilters
              ? "Попробуйте изменить фильтры или создайте новый материал."
              : "В библиотеке пока нет материалов."
          }
          action={
            <Button size="sm" onClick={() => setShowCreateForm(true)}>
              <Plus aria-hidden />
              Создать материал
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {[...tree.entries()].map(([subj, grades]) => (
            <section key={subj}>
              <h2 className="ds-label mb-2">{subj}</h2>
              <div className="flex flex-col gap-4">
                {[...grades.entries()].map(([gr, topics]) => (
                  <div key={gr}>
                    <h3 className="mb-1.5 text-sm font-semibold text-muted-foreground">{gr} класс</h3>
                    <div className="flex flex-col gap-3 border-l-2 border-border pl-4">
                      {[...topics.entries()].map(([tp, materials]) => (
                        <div key={tp}>
                          <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-3">
                            {tp === NO_TOPIC ? "Без темы" : tp}
                          </h4>
                          <div className="flex flex-col gap-2">
                            {materials.map((m) => (
                              <MaterialRow key={m.id} material={m} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

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
    return [
      ...new Set(
        text
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const grades = parseGrades(gradesText);
    if (!title.trim() || !subject.trim() || grades.length === 0) {
      setError("Заполните заголовок, предмет и хотя бы один класс (число)");
      return;
    }
    const template = MATERIAL_TEMPLATES.find((t) => t.id === templateId) ?? MATERIAL_TEMPLATES[0]!;
    const content = buildMaterialFromTemplate(template, {
      title: title.trim(),
      subject: subject.trim(),
      grades,
      topic,
    });
    setSubmitting(true);
    setError(null);
    try {
      const result = await createMaterial(content);
      toast.success("Материал создан");
      navigate(`/materials/${result.materialId}/edit`);
    } catch {
      setError("Не удалось создать материал — попробуйте ещё раз");
      setSubmitting(false);
    }
  }

  return (
    <Card className="mb-6 p-5">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="cm-title">Заголовок</Label>
            <Input id="cm-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cm-subject">Предмет</Label>
            <Input
              id="cm-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="математика"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cm-grades">Классы</Label>
            <Input
              id="cm-grades"
              value={gradesText}
              onChange={(e) => setGradesText(e.target.value)}
              placeholder="8 или 8, 9"
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="cm-topic">Тема (необязательно)</Label>
            <Input id="cm-topic" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Шаблон</span>
          <RadioGroup value={templateId} onValueChange={setTemplateId} className="gap-2">
            {MATERIAL_TEMPLATES.map((t) => (
              <label
                key={t.id}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 transition-colors hover:bg-secondary has-[:checked]:border-primary has-[:checked]:bg-accent"
              >
                <RadioGroupItem value={t.id} className="mt-0.5" />
                <span>
                  <span className="text-sm font-semibold text-foreground">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">{t.description}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>

        {error ? (
          <p className="text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" size="sm" loading={submitting}>
            {submitting ? "Создание…" : "Создать"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
        </div>
      </form>
    </Card>
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
      toast.error("Буфер обмена недоступен");
    }
  }

  return (
    <Card className="flex items-center justify-between gap-3 px-3.5 py-2.5 transition-colors hover:border-primary-muted">
      <Link
        to={`/materials/${material.id}/edit`}
        className="flex min-w-0 items-center gap-2 text-sm font-medium hover:text-primary hover:underline"
      >
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{material.title}</span>
        <Badge variant={STATUS_VARIANT[material.status]} className="shrink-0">
          {STATUS_LABEL[material.status]}
        </Badge>
      </Link>
      <Button variant="ghost" size="sm" className="shrink-0" onClick={copyId}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Скопировано" : `id ${material.id.slice(0, 8)}…`}
      </Button>
    </Card>
  );
}

function TreeSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1].map((s) => (
        <div key={s} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

function buildTree(
  items: MaterialSummary[],
): Map<string, Map<number, Map<string, MaterialSummary[]>>> {
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
