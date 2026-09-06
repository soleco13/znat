import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Plus, SquarePen } from "lucide-react";
import type { MaterialStatus, MaterialSummary } from "@school/shared";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { EmptyState } from "@/shared/ui/empty-state";
import { ErrorState } from "@/shared/ui/error-state";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { PageHeader } from "@/shared/ui/page-header";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/sonner";
import { buildBlankMaterial } from "./material-templates.js";
import { createMaterial, listMaterials } from "./materials-api.js";

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
const SECTION_ORDER: { status: MaterialStatus; title: string; hint: string }[] = [
  { status: "draft", title: "Черновики", hint: "В работе, видны только персоналу" },
  { status: "review", title: "На ревью", hint: "Ждут проверки методистом или администратором" },
  { status: "published", title: "Опубликованные", hint: "Доступны учителям для уроков" },
];

/**
 * Вкладка «Редактор» (Э13) — рабочее пространство автора материалов
 * (admin + methodist). Список материалов по статусам + мгновенное создание
 * пустого черновика. Наполнение (блоки, конструкции) — уже в самом листе
 * `/materials/edit/:id`, поэтому здесь форма создания минимальна.
 */
export function MaterialsEditorLandingPage() {
  const [items, setItems] = useState<MaterialSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMaterials()
      .then((data) => !cancelled && setItems(data.items))
      .catch(() => !cancelled && setError("Не удалось загрузить материалы"));
    return () => {
      cancelled = true;
    };
  }, []);

  const bySection = useMemo(() => {
    const map = new Map<MaterialStatus, MaterialSummary[]>();
    for (const item of items ?? []) {
      const list = map.get(item.status) ?? [];
      list.push(item);
      map.set(item.status, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return map;
  }, [items]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Редактор материалов"
        subtitle="Создавайте и правьте учебные материалы. Готовые публикуются в библиотеку."
        actions={<NewMaterialDialog />}
      />

      {error ? (
        <ErrorState description={error} />
      ) : !items ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={SquarePen}
          title="Пока нет материалов"
          description="Создайте первый — дальше добавите текст, вопросы и готовые конструкции прямо в листе."
          action={<NewMaterialDialog />}
        />
      ) : (
        <div className="flex flex-col gap-8">
          {SECTION_ORDER.map(({ status, title, hint }) => {
            const list = bySection.get(status) ?? [];
            if (list.length === 0) return null;
            return (
              <section key={status}>
                <div className="mb-3">
                  <h2 className="ds-label">{title}</h2>
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((m) => (
                    <MaterialCard key={m.id} material={m} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MaterialCard({ material }: { material: MaterialSummary }) {
  const navigate = useNavigate();
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/materials/edit/${material.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/materials/edit/${material.id}`);
        }
      }}
      className="flex cursor-pointer flex-col gap-2 p-4 transition-colors hover:border-primary-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Badge variant={STATUS_VARIANT[material.status]} className="shrink-0">
          {STATUS_LABEL[material.status]}
        </Badge>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{material.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {material.subject}
          {material.grades.length > 0 ? ` · ${material.grades.join(", ")} кл.` : ""}
          {material.topic ? ` · ${material.topic}` : ""}
        </p>
      </div>
      <p className="text-[11px] text-text-3">
        изменён {new Date(material.updatedAt).toLocaleDateString("ru-RU")}
      </p>
    </Card>
  );
}

function NewMaterialDialog() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [gradesText, setGradesText] = useState("");
  const [topic, setTopic] = useState("");
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
      setError("Заполните название, предмет и хотя бы один класс (числом)");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await createMaterial(
        buildBlankMaterial({ title: title.trim(), subject: subject.trim(), grades, topic }),
      );
      toast.success("Черновик создан");
      navigate(`/materials/edit/${result.materialId}`);
    } catch {
      setError("Не удалось создать материал — попробуйте ещё раз");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden />
          Новый материал
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый материал</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nm-title">Название</Label>
            <Input
              id="nm-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Квадратные уравнения"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nm-subject">Предмет</Label>
              <Input
                id="nm-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="математика"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nm-grades">Классы</Label>
              <Input
                id="nm-grades"
                value={gradesText}
                onChange={(e) => setGradesText(e.target.value)}
                placeholder="8 или 8, 9"
                inputMode="numeric"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nm-topic">Тема (необязательно)</Label>
            <Input id="nm-topic" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </div>

          {error ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" size="sm" loading={submitting}>
              Создать и открыть
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
