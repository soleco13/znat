import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { LessonAttendance, LessonMaterial, LessonSummary, MaterialSummary } from "@school/shared";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/sonner";
import { listMaterials } from "@/features/materials/materials-api.js";
import {
  assignLessonMaterial,
  getAttendance,
  listLessonMaterials,
  unassignLessonMaterial,
} from "./lessons-api.js";

/**
 * Диалоги кабинета учителя: журнал посещений и материалы урока. Те же, что
 * в админском `LessonsListPage` (там они свои, внутри файла — админскую
 * страницу не трогаем), плюс `onChanged`, чтобы плитка обновила число.
 */
export function AttendanceDialog({
  lesson,
  onClose,
}: {
  lesson: LessonSummary | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<LessonAttendance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lesson) return;
    setData(null);
    setError(null);
    getAttendance(lesson.id)
      .then(setData)
      .catch(() => setError("Не удалось загрузить журнал"));
  }, [lesson]);

  return (
    <Dialog open={Boolean(lesson)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Журнал посещений</DialogTitle>
          <DialogDescription>{lesson?.title}</DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !data ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : data.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Ещё никто не входил</p>
        ) : (
          <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Имя</th>
                  <th className="px-3 py-2 text-left font-medium">Вход</th>
                  <th className="px-3 py-2 text-left font-medium">Выход</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.participantId} className="border-t border-border">
                    <td className="px-3 py-2">
                      {r.displayName}
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {r.kind === "staff" ? "· персонал" : "· ученик"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(r.joinedAt).toLocaleString("ru-RU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.leftAt
                        ? new Date(r.leftAt).toLocaleTimeString("ru-RU", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function LessonMaterialsDialog({
  lesson,
  onClose,
  onChanged,
}: {
  lesson: LessonSummary | null;
  onClose: () => void;
  /** Состав материалов изменился — чтобы плитка урока показала новое число. */
  onChanged?: (lessonId: string, items: LessonMaterial[]) => void;
}) {
  const [items, setItems] = useState<LessonMaterial[] | null>(null);
  /** Что можно назначить: материалы Матиса и своей организации — отдельными группами списка. */
  const [available, setAvailable] = useState<{ platform: MaterialSummary[]; school: MaterialSummary[] } | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!lesson) return;
    setItems(null);
    setAvailable(null);
    setSelected("");
    setError(null);
    Promise.all([
      listLessonMaterials(lesson.id),
      listMaterials({ source: "platform" }),
      listMaterials({ status: "published" }),
    ])
      .then(([materials, platform, school]) => {
        setItems(materials.items);
        setAvailable({ platform: platform.items, school: school.items });
      })
      .catch(() => setError("Не удалось загрузить материалы"));
  }, [lesson]);

  const assignedIds = useMemo(() => new Set((items ?? []).map((m) => m.materialId)), [items]);
  const groups = useMemo(
    () =>
      [
        { label: "Матис", items: (available?.platform ?? []).filter((m) => !assignedIds.has(m.id)) },
        { label: "Материалы организации", items: (available?.school ?? []).filter((m) => !assignedIds.has(m.id)) },
      ].filter((g) => g.items.length > 0),
    [available, assignedIds],
  );

  async function add() {
    if (!lesson || !selected) return;
    setBusy(true);
    try {
      const res = await assignLessonMaterial(lesson.id, selected);
      setItems(res.items);
      onChanged?.(lesson.id, res.items);
      setSelected("");
    } catch {
      toast.error("Не удалось назначить материал");
    } finally {
      setBusy(false);
    }
  }

  async function remove(materialId: string) {
    if (!lesson) return;
    setBusy(true);
    try {
      await unassignLessonMaterial(lesson.id, materialId);
      const next = (items ?? []).filter((m) => m.materialId !== materialId);
      setItems(next);
      onChanged?.(lesson.id, next);
    } catch {
      toast.error("Не удалось снять материал");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(lesson)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Материалы урока</DialogTitle>
          <DialogDescription>
            {lesson?.title} — ученики увидят их по ссылке урока
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !items || !available ? (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.length === 0 ? (
              <p className="py-2 text-center text-sm text-muted-foreground">
                Материалы не назначены
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {m.materialTitle}
                      </span>
                      <span className="block text-xs text-muted-foreground">{m.subject}</span>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Снять материал"
                      disabled={busy}
                      onClick={() => void remove(m.materialId)}
                    >
                      <X aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-2">
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Добавить материал" />
                </SelectTrigger>
                <SelectContent>
                  {groups.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Нет доступных опубликованных материалов
                    </div>
                  ) : (
                    groups.map((g) => (
                      <SelectGroup key={g.label}>
                        <SelectLabel>{g.label}</SelectLabel>
                        {g.items.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.title}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button onClick={() => void add()} disabled={!selected || busy}>
                Добавить
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
