import { useEffect, useState } from "react";
import type { MaterialStatus, MaterialSummary } from "@school/shared";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { listMaterials } from "./materials-api.js";

const STATUS_SUFFIX: Record<MaterialStatus, string> = {
  draft: " · черновик",
  review: " · на ревью",
  published: "",
};

/** Выбор материала из библиотеки — вместо ручного ввода id. */
export function MaterialPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (materialId: string) => void;
  className?: string;
}) {
  const [items, setItems] = useState<MaterialSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMaterials({})
      .then((res) => !cancelled && setItems(res.items))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const published = items?.filter((m) => m.status === "published") ?? [];
  const drafts = items?.filter((m) => m.status !== "published") ?? [];

  return (
    <Select value={value} onValueChange={onChange} disabled={items === null}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={items === null ? "Загрузка…" : "Выберите материал"} />
      </SelectTrigger>
      <SelectContent>
        {items && items.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            В библиотеке пока нет материалов
          </div>
        ) : null}
        {published.length > 0 ? (
          <SelectGroup>
            <SelectLabel>Опубликованные</SelectLabel>
            {published.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.title}
              </SelectItem>
            ))}
          </SelectGroup>
        ) : null}
        {drafts.length > 0 ? (
          <SelectGroup>
            <SelectLabel>Черновики</SelectLabel>
            {drafts.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.title}
                {STATUS_SUFFIX[m.status]}
              </SelectItem>
            ))}
          </SelectGroup>
        ) : null}
      </SelectContent>
    </Select>
  );
}
