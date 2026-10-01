import { useCallback, useEffect, useState } from "react";
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
  const [platformItems, setPlatformItems] = useState<MaterialSummary[]>([]);

  // Обновляем список и при открытии выпадашки — материал, опубликованный
  // методистом уже во время урока, должен появиться без перезагрузки комнаты.
  // Материалы Матиса лежат в отдельном пространстве — `GET /materials` без
  // `source` их не отдаёт, хотя выдать их на урок можно (`getLatestMaterial`).
  const load = useCallback(() => {
    listMaterials({})
      .then((res) => setItems(res.items))
      .catch(() => setItems((prev) => prev ?? []));
    listMaterials({ source: "platform" })
      .then((res) => setPlatformItems(res.items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const published = items?.filter((m) => m.status === "published") ?? [];
  const drafts = items?.filter((m) => m.status !== "published") ?? [];
  // Для сотрудников самого Матиса это те же материалы, что и свои.
  const ownIds = new Set(items?.map((m) => m.id));
  const platform = platformItems.filter((m) => !ownIds.has(m.id));

  return (
    <Select
      value={value}
      onValueChange={onChange}
      disabled={items === null}
      onOpenChange={(open) => open && load()}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={items === null ? "Загрузка…" : "Выберите материал"} />
      </SelectTrigger>
      <SelectContent>
        {items && items.length === 0 && platform.length === 0 ? (
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
        {platform.length > 0 ? (
          <SelectGroup>
            <SelectLabel>Матис</SelectLabel>
            {platform.map((m) => (
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
