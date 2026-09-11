import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Link2,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import type {
  LessonAttendance,
  LessonMaterial,
  LessonSettings,
  LessonSummary,
  MaterialSummary,
  UserResponse,
} from "@school/shared";

import { useAuthStore } from "@/shared/auth-store";
import { useAsync } from "@/shared/hooks/use-async";
import { ApiError } from "@/shared/api-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { EmptyState } from "@/shared/ui/empty-state";
import { ErrorState } from "@/shared/ui/error-state";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
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
import { listMaterials } from "@/features/materials/materials-api.js";
import {
  assignLessonMaterial,
  createLesson,
  deleteLesson,
  getAttendance,
  getPresenceCounts,
  listLessonMaterials,
  listLessons,
  listTeachers,
  rotateJoinLink,
  unassignLessonMaterial,
  updateLesson,
} from "./lessons-api.js";

function joinUrl(joinPath: string): string {
  return `${window.location.origin}${joinPath}`;
}

async function copyJoinLink(joinPath: string) {
  try {
    await navigator.clipboard.writeText(joinUrl(joinPath));
    toast.success("Ссылка для учеников скопирована");
  } catch {
    toast.error("Не удалось скопировать ссылку");
  }
}

function formatSchedule(iso: string | null): string {
  if (!iso) return "Без планового времени";
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS_FIELDS: { key: keyof LessonSettings; label: string; hint: string }[] = [
  { key: "autoRecord", label: "Автозапись урока", hint: "Начинать запись при первом входе персонала" },
  { key: "studentsCanDraw", label: "Ученики рисуют на доске", hint: "Без отдельного разрешения учителя" },
  {
    key: "studentsCanSpeak",
    label: "Ученики включают микрофон",
    hint: "Все сразу, без разрешения учителя (лимит «не более 4» при этом не действует)",
  },
  {
    key: "studentsCanPublishVideo",
    label: "Ученики включают камеру",
    hint: "Максимум 360p, без отдельного разрешения",
  },
  { key: "studentsCanShareScreen", label: "Ученики показывают экран", hint: "Без отдельного разрешения" },
];

interface LessonFormValue {
  title: string;
  teacherId: string;
  scheduledAt: string;
  settings: Partial<LessonSettings>;
}

/** datetime-local ⇄ ISO. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

function LessonFormDialog({
  open,
  onOpenChange,
  teachers,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  teachers: UserResponse[];
  editing: LessonSummary | null;
  onSaved: (lesson: LessonSummary) => void;
}) {
  const [value, setValue] = useState<LessonFormValue>({
    title: "",
    teacherId: "",
    scheduledAt: "",
    settings: {},
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setValue(
      editing
        ? {
            title: editing.title,
            teacherId: editing.teacherId,
            scheduledAt: toLocalInput(editing.scheduledAt),
            settings: { ...editing.settings },
          }
        : { title: "", teacherId: "", scheduledAt: "", settings: {} },
    );
  }, [open, editing]);

  async function submit() {
    if (!value.title.trim() || !value.teacherId) return;
    setSaving(true);
    setError(null);
    const scheduledAt = value.scheduledAt ? new Date(value.scheduledAt).toISOString() : null;
    try {
      const saved = editing
        ? await updateLesson(editing.id, {
            title: value.title.trim(),
            teacherId: value.teacherId,
            scheduledAt,
            settings: value.settings,
          })
        : await createLesson({
            title: value.title.trim(),
            teacherId: value.teacherId,
            scheduledAt,
            settings: value.settings,
          });
      onSaved(saved);
      onOpenChange(false);
      toast.success(editing ? "Урок обновлён" : "Урок создан");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить урок");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Настройки урока" : "Новый урок"}</DialogTitle>
          <DialogDescription>
            Постоянная комната. Ученики входят по ссылке, вводя имя.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lesson-title">Название</Label>
            <Input
              id="lesson-title"
              value={value.title}
              onChange={(e) => setValue((v) => ({ ...v, title: e.target.value }))}
              placeholder="Алгебра, 9 класс"
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Учитель</Label>
            <Select
              value={value.teacherId}
              onValueChange={(teacherId) => setValue((v) => ({ ...v, teacherId }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Выберите учителя" />
              </SelectTrigger>
              <SelectContent>
                {teachers.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    Нет активных учителей
                  </div>
                ) : (
                  teachers.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.fullName}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lesson-when">Плановое время (необязательно)</Label>
            <Input
              id="lesson-when"
              type="datetime-local"
              value={value.scheduledAt}
              onChange={(e) => setValue((v) => ({ ...v, scheduledAt: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Только метка для сортировки — урок доступен всегда.
            </p>
          </div>

          <fieldset className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold text-muted-foreground">
              Права учеников
            </legend>
            {SETTINGS_FIELDS.map(({ key, label, hint }) => (
              <label key={key} className="flex items-start gap-2.5">
                <Checkbox
                  className="mt-0.5"
                  checked={Boolean(value.settings[key])}
                  onCheckedChange={(c) =>
                    setValue((v) => ({ ...v, settings: { ...v.settings, [key]: c === true } }))
                  }
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {error ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit} loading={saving} disabled={!value.title.trim() || !value.teacherId}>
            {editing ? "Сохранить" : "Создать урок"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AttendanceDialog({
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

function LessonMaterialsDialog({
  lesson,
  onClose,
}: {
  lesson: LessonSummary | null;
  onClose: () => void;
}) {
  const [items, setItems] = useState<LessonMaterial[] | null>(null);
  const [available, setAvailable] = useState<MaterialSummary[] | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!lesson) return;
    setItems(null);
    setAvailable(null);
    setSelected("");
    setError(null);
    Promise.all([listLessonMaterials(lesson.id), listMaterials({ status: "published" })])
      .then(([materials, library]) => {
        setItems(materials.items);
        setAvailable(library.items);
      })
      .catch(() => setError("Не удалось загрузить материалы"));
  }, [lesson]);

  const assignedIds = useMemo(() => new Set((items ?? []).map((m) => m.materialId)), [items]);
  const options = useMemo(
    () => (available ?? []).filter((m) => !assignedIds.has(m.id)),
    [available, assignedIds],
  );

  async function add() {
    if (!lesson || !selected) return;
    setBusy(true);
    try {
      const res = await assignLessonMaterial(lesson.id, selected);
      setItems(res.items);
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
      setItems((prev) => (prev ?? []).filter((m) => m.materialId !== materialId));
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
                  {options.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Нет доступных опубликованных материалов
                    </div>
                  ) : (
                    options.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.title}
                      </SelectItem>
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

// ─────────────────────────────────────────────────────────────────────────────

function LessonRow({
  lesson,
  isAdmin,
  presenceCount,
  onEdit,
  onAttendance,
  onMaterials,
  onRotate,
  onDelete,
}: {
  lesson: LessonSummary;
  isAdmin: boolean;
  /** Сколько человек сейчас в комнате урока (Э12 полировка) — `undefined`, пока не подгрузилось. */
  presenceCount: number | undefined;
  onEdit: () => void;
  onAttendance: () => void;
  onMaterials: () => void;
  onRotate: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4 transition-shadow hover:shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary">
          <Video className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold text-foreground">{lesson.title}</span>
            {presenceCount ? (
              <Badge variant="green" className="shrink-0">
                <Users aria-hidden />
                {presenceCount}
              </Badge>
            ) : null}
          </span>
          <div className="mt-0.5 text-sm text-muted-foreground">
            {lesson.teacherName} · {formatSchedule(lesson.scheduledAt)}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => void copyJoinLink(lesson.joinPath)}>
          <Link2 aria-hidden />
          Ссылка
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link to={`/lessons/${lesson.id}/room`}>
            Войти
            <ArrowRight aria-hidden />
          </Link>
        </Button>
        {isAdmin ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Действия с уроком">
                <MoreVertical aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil aria-hidden />
                Переименовать и настройки
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onAttendance}>
                <Users aria-hidden />
                Журнал посещений
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onMaterials}>
                <BookOpen aria-hidden />
                Материалы урока
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onRotate}>
                <RefreshCw aria-hidden />
                Перевыпустить ссылку
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onDelete}
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <Trash2 aria-hidden />
                Удалить урок
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function LessonsListPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === "admin";

  const { data, error, loading, reload, setData } = useAsync(() => listLessons(), []);
  const teachersAsync = useAsync(() => (isAdmin ? listTeachers() : Promise.resolve([])), [isAdmin]);
  const teachers = useMemo(() => teachersAsync.data ?? [], [teachersAsync.data]);

  // Э12 полировка: «сколько человек в комнате» — отдельным лёгким запросом,
  // чтобы не тормозить основной список уроков.
  const lessonIdsKey = data?.items.map((l) => l.id).join(",") ?? "";
  const presenceAsync = useAsync(
    () => getPresenceCounts(lessonIdsKey ? lessonIdsKey.split(",") : []),
    [lessonIdsKey],
  );
  const presence = presenceAsync.data ?? {};

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LessonSummary | null>(null);
  const [attendanceFor, setAttendanceFor] = useState<LessonSummary | null>(null);
  const [materialsFor, setMaterialsFor] = useState<LessonSummary | null>(null);
  const [rotateFor, setRotateFor] = useState<LessonSummary | null>(null);
  const [deleteFor, setDeleteFor] = useState<LessonSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const upsertLocal = useCallback(
    (lesson: LessonSummary) =>
      setData((prev) => {
        const items = prev?.items ?? [];
        const exists = items.some((l) => l.id === lesson.id);
        return { items: exists ? items.map((l) => (l.id === lesson.id ? lesson : l)) : [lesson, ...items] };
      }),
    [setData],
  );

  async function confirmRotate() {
    if (!rotateFor) return;
    setBusy(true);
    try {
      const link = await rotateJoinLink(rotateFor.id);
      upsertLocal({ ...rotateFor, joinToken: link.joinToken, joinPath: link.joinPath });
      toast.success("Ссылка перевыпущена — старая больше не работает");
      setRotateFor(null);
    } catch {
      toast.error("Не удалось перевыпустить ссылку");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteFor) return;
    setBusy(true);
    try {
      await deleteLesson(deleteFor.id);
      setData((prev) => ({ items: (prev?.items ?? []).filter((l) => l.id !== deleteFor.id) }));
      toast.success("Урок удалён");
      setDeleteFor(null);
    } catch {
      toast.error("Не удалось удалить урок");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Уроки"
        subtitle="Постоянные комнаты уроков и ссылки для учеников"
        actions={
          isAdmin ? (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus aria-hidden />
              Создать урок
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="flex items-center gap-3.5 p-4">
              <Skeleton className="size-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
              <Skeleton className="h-8 w-20 rounded-md" />
            </Card>
          ))}
        </div>
      ) : error ? (
        <ErrorState description={error} onRetry={reload} />
      ) : data && data.items.length > 0 ? (
        <div className="flex flex-col gap-3">
          {data.items.map((lesson) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              isAdmin={isAdmin}
              presenceCount={presence[lesson.id]}
              onEdit={() => {
                setEditing(lesson);
                setFormOpen(true);
              }}
              onAttendance={() => setAttendanceFor(lesson)}
              onMaterials={() => setMaterialsFor(lesson)}
              onRotate={() => setRotateFor(lesson)}
              onDelete={() => setDeleteFor(lesson)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={CalendarDays}
          title="Уроков пока нет"
          description={
            isAdmin
              ? "Создайте первый урок — получите ссылку, которую можно раздать ученикам."
              : "Уроки создаёт администратор."
          }
          action={
            isAdmin ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus aria-hidden />
                Создать урок
              </Button>
            ) : undefined
          }
        />
      )}

      {isAdmin ? (
        <>
          <LessonFormDialog
            open={formOpen}
            onOpenChange={setFormOpen}
            teachers={teachers}
            editing={editing}
            onSaved={upsertLocal}
          />
          <AttendanceDialog lesson={attendanceFor} onClose={() => setAttendanceFor(null)} />
          <LessonMaterialsDialog lesson={materialsFor} onClose={() => setMaterialsFor(null)} />

          <AlertDialog open={Boolean(rotateFor)} onOpenChange={(v) => !v && setRotateFor(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Перевыпустить ссылку урока?</AlertDialogTitle>
                <AlertDialogDescription>
                  Текущая ссылка «{rotateFor?.title}» перестанет работать сразу. Ученикам и учителю
                  нужно будет раздать новую.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction onClick={confirmRotate} disabled={busy}>
                  Перевыпустить
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={Boolean(deleteFor)} onOpenChange={(v) => !v && setDeleteFor(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Удалить урок «{deleteFor?.title}»?</AlertDialogTitle>
                <AlertDialogDescription>
                  Комната, доска, журнал посещений и назначенные материалы будут удалены. Действие
                  необратимо.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmDelete}
                  disabled={busy}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Удалить
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </div>
  );
}
