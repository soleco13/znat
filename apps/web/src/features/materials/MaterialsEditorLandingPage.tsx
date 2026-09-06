import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Plus, SquarePen } from "lucide-react";
import type { MaterialStatus, MaterialSummary } from "@school/shared";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { ErrorState } from "@/shared/ui/error-state";
import { PageHeader } from "@/shared/ui/page-header";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/sonner";
import { buildPlaceholderDraft } from "./material-templates.js";
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
        actions={<NewMaterialButton />}
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
          action={<NewMaterialButton />}
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
          {material.subject === "—" ? (
            "данные не заполнены"
          ) : (
            <>
              {material.subject}
              {material.grades.length > 0 ? ` · ${material.grades.join(", ")} кл.` : ""}
              {material.topic ? ` · ${material.topic}` : ""}
            </>
          )}
        </p>
      </div>
      <p className="text-[11px] text-text-3">
        изменён {new Date(material.updatedAt).toLocaleDateString("ru-RU")}
      </p>
    </Card>
  );
}

function NewMaterialButton() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      // Мгновенно создаём пустой черновик (Э13). Название и класс методист
      // укажет в самом листе при «Сохранить».
      const result = await createMaterial(buildPlaceholderDraft());
      navigate(`/materials/edit/${result.materialId}`);
    } catch {
      toast.error("Не удалось создать материал — попробуйте ещё раз");
      setBusy(false);
    }
  }

  return (
    <Button size="sm" loading={busy} onClick={create}>
      <Plus aria-hidden />
      Новый материал
    </Button>
  );
}
