import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, FileText, Library, SquarePen } from "lucide-react";
import type { ListMaterialsQuery, MaterialStatus, MaterialSummary } from "@school/shared";

import { useAuthStore } from "@/shared/auth-store";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { ErrorState } from "@/shared/ui/error-state";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/sonner";
import { listMaterials } from "./materials-api.js";

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

// Э12.9: заглушка «недоступно роли ученик» убрана — роли `student` больше
// нет, библиотеку листает только персонал (роут под `RequireRole`).
export function MaterialsLibraryPage() {
  // Ревизия Э12.7: создают/правят материалы только admin/methodist.
  // Учитель — читатель: библиотека, просмотр материала, выбор на урок.
  const role = useAuthStore((s) => s.user?.role);
  const isAuthor = role === "admin" || role === "methodist";
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
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Библиотека материалов"
        subtitle={
          isAuthor
            ? "Дерево предмет → класс → тема, поиск и статусы"
            : "Опубликованные материалы — выберите на урок или откройте для просмотра"
        }
        actions={
          isAuthor ? (
            <Button asChild size="sm">
              <Link to="/materials/edit">
                <SquarePen aria-hidden />
                Редактор
              </Link>
            </Button>
          ) : undefined
        }
      />

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
          {isAuthor ? (
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
          ) : null}
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
              ? "Попробуйте изменить фильтры."
              : isAuthor
                ? "В библиотеке пока нет материалов."
                : "В библиотеке пока нет опубликованных материалов."
          }
          action={
            isAuthor ? (
              <Button asChild size="sm">
                <Link to="/materials/edit">
                  <SquarePen aria-hidden />
                  Открыть редактор
                </Link>
              </Button>
            ) : undefined
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
        to={`/materials/edit/${material.id}`}
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
