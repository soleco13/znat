import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Eye, HardDrive, Link2, Search, Trash2, Video, X } from "lucide-react";
import type { AdminRecordingSummary, RecordingStatus } from "@school/shared";

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
import { EmptyState } from "@/shared/ui/empty-state";
import { ErrorState } from "@/shared/ui/error-state";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/page-header";
import { Progress } from "@/shared/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";
import {
  formatBytes,
  formatDate,
  formatDuration,
  isDeletable,
  STATUS_LABEL,
  STATUS_VARIANT,
} from "./format.js";
import {
  adminDeleteRecording,
  createExternalDownloadLink,
  getStorageUsage,
  listAllRecordings,
} from "./recordings-api.js";

/**
 * Пользовательский запрос (2026-09-12, §10.10 ТЗ): страница для админа —
 * место на диске (всего/занято/свободно), весь архив записей школы одним
 * списком (не по урокам), внешняя ссылка на скачивание и ручное удаление
 * файла из хранилища. Доступ — только `admin` (роут в App.tsx, повторная
 * проверка на сервере в каждом эндпоинте — `recordings/service.ts`).
 */

const PAGE_SIZE = 20;

const STATUS_FILTER_OPTIONS: Array<{ value: RecordingStatus | "all"; label: string }> = [
  { value: "all", label: "Любой статус" },
  { value: "ready", label: STATUS_LABEL.ready },
  { value: "recording", label: STATUS_LABEL.recording },
  { value: "processing", label: STATUS_LABEL.processing },
  { value: "starting", label: STATUS_LABEL.starting },
  { value: "failed", label: STATUS_LABEL.failed },
  { value: "aborted", label: STATUS_LABEL.aborted },
  { value: "deleted", label: STATUS_LABEL.deleted },
];

function StorageUsageCard() {
  const { data, error, loading, reload, refreshing } = useAsync(() => getStorageUsage(), []);

  if (loading) {
    return (
      <Card className="p-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-3 h-2 w-full" />
        <Skeleton className="mt-2 h-3 w-64" />
      </Card>
    );
  }
  if (error || !data) {
    return <ErrorState description={error ?? undefined} onRetry={reload} retrying={refreshing} />;
  }

  const usedPct = data.totalBytes > 0 ? (data.usedBytes / data.totalBytes) * 100 : 0;
  const tone = usedPct >= 90 ? "danger" : usedPct >= 75 ? "warning" : "primary";

  return (
    <Card className="p-4">
      <h2 className="ds-label flex items-center gap-2">
        <HardDrive className="size-3.5" aria-hidden /> Место на диске
      </h2>
      <Progress value={usedPct} tone={tone} className="mt-3" />
      <p className="mt-2 text-sm text-muted-foreground">
        Занято <span className="font-semibold text-foreground">{formatBytes(data.usedBytes)}</span>{" "}
        из {formatBytes(data.totalBytes)} · свободно {formatBytes(data.freeBytes)} · из них записи
        уроков — {formatBytes(data.recordingsBytes)}
      </p>
    </Card>
  );
}

/** Архив школы за один запрос (§10.10 ТЗ — «одним списком»); поиск/фильтр/пагинация — на клиенте. */
const FETCH_SIZE = 100;

export function AdminRecordingsPage() {
  const navigate = useNavigate();
  const { data, error, loading, refreshing, reload, setData } = useAsync(
    () => listAllRecordings(1, FETCH_SIZE),
    [],
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RecordingStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTargets, setDeleteTargets] = useState<AdminRecordingSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkBusyId, setLinkBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.items.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return r.lessonTitle.toLowerCase().includes(q) || r.teacherName.toLowerCase().includes(q);
    });
  }, [data, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageSelectableIds = pageItems.filter((r) => isDeletable(r.status)).map((r) => r.id);
  const allPageSelected =
    pageSelectableIds.length > 0 && pageSelectableIds.every((id) => selected.has(id));

  function resetToFirstPage() {
    setPage(1);
    setSelected(new Set());
  }

  function toggleSelected(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllOnPage(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of pageSelectableIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function copyExternalLink(recording: AdminRecordingSummary) {
    setLinkBusyId(recording.id);
    try {
      const link = await createExternalDownloadLink(recording.id);
      await navigator.clipboard.writeText(link.url);
      toast.success("Внешняя ссылка скопирована — действует 24 часа");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось создать ссылку");
    } finally {
      setLinkBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTargets || deleteTargets.length === 0 || !data) return;
    setBusy(true);
    const ids = new Set(deleteTargets.map((r) => r.id));
    const failed: string[] = [];
    for (const target of deleteTargets) {
      try {
        await adminDeleteRecording(target.id);
      } catch {
        failed.push(target.lessonTitle);
        ids.delete(target.id);
      }
    }
    setData({
      ...data,
      items: data.items.map((r) =>
        ids.has(r.id) ? { ...r, status: "deleted" as const, url: null, sizeBytes: null } : r,
      ),
    });
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    if (failed.length > 0) {
      toast.error(`Не удалось удалить: ${failed.join(", ")}`);
    } else {
      toast.success(deleteTargets.length > 1 ? `Удалено записей: ${ids.size}` : "Запись удалена из хранилища");
    }
    setBusy(false);
    setDeleteTargets(null);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Записи уроков" subtitle="Место на диске и архив видеозаписей всей школы" />

      <div className="mb-5">
        <StorageUsageCard />
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState description={error} onRetry={reload} retrying={refreshing} />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  resetToFirstPage();
                }}
                placeholder="Поиск по уроку или учителю…"
                className="pl-9 pr-9"
              />
              {search ? (
                <button
                  type="button"
                  aria-label="Очистить поиск"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setSearch("");
                    resetToFirstPage();
                  }}
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as RecordingStatus | "all");
                resetToFirstPage();
              }}
            >
              <SelectTrigger className="sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selected.size > 0 ? (
            <div className="mb-3 flex items-center justify-between rounded-md border border-primary/20 bg-primary-light px-3.5 py-2 text-sm">
              <span className="font-medium text-primary">Выбрано: {selected.size}</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Снять выбор
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    setDeleteTargets(data.items.filter((r) => selected.has(r.id)))
                  }
                >
                  <Trash2 aria-hidden />
                  Удалить выбранные
                </Button>
              </div>
            </div>
          ) : null}

          {pageItems.length === 0 ? (
            <EmptyState
              icon={Search}
              title="Ничего не найдено"
              description="Попробуйте изменить поиск или фильтр по статусу."
            />
          ) : (
            <Card className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allPageSelected}
                        disabled={pageSelectableIds.length === 0}
                        onCheckedChange={(v) => toggleAllOnPage(v === true)}
                        aria-label="Выбрать все на странице"
                      />
                    </TableHead>
                    <TableHead>Урок</TableHead>
                    <TableHead>Учитель</TableHead>
                    <TableHead>Начало</TableHead>
                    <TableHead>Длительность</TableHead>
                    <TableHead>Размер</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageItems.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(r.id)}
                          disabled={!isDeletable(r.status)}
                          onCheckedChange={(v) => toggleSelected(r.id, v === true)}
                          aria-label={`Выбрать «${r.lessonTitle}»`}
                        />
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate font-medium text-foreground">
                        {r.lessonTitle}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.teacherName}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(r.startedAt)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDuration(r.durationSec)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatBytes(r.sizeBytes)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          {r.status === "ready" ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Смотреть"
                              onClick={() => navigate(`/admin/recordings/${r.id}`)}
                            >
                              <Eye aria-hidden />
                            </Button>
                          ) : null}
                          {r.url ? (
                            <Button asChild variant="ghost" size="icon-sm" aria-label="Скачать">
                              <a href={r.url} target="_blank" rel="noreferrer">
                                <Download aria-hidden />
                              </a>
                            </Button>
                          ) : null}
                          {r.status === "ready" ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Скопировать внешнюю ссылку"
                              onClick={() => void copyExternalLink(r)}
                              loading={linkBusyId === r.id}
                            >
                              <Link2 aria-hidden />
                            </Button>
                          ) : null}
                          {isDeletable(r.status) ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Удалить запись"
                              className="text-destructive hover:bg-destructive/10"
                              onClick={() => setDeleteTargets([r])}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      ) : (
        <EmptyState icon={Video} title="Записей пока нет" description="Записи уроков появятся здесь." />
      )}

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Назад
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Далее
          </Button>
        </div>
      ) : null}

      <AlertDialog open={Boolean(deleteTargets)} onOpenChange={(v) => !v && setDeleteTargets(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTargets && deleteTargets.length > 1
                ? `Удалить ${deleteTargets.length} записи?`
                : `Удалить запись «${deleteTargets?.[0]?.lessonTitle}»?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Файл{deleteTargets && deleteTargets.length > 1 ? "ы" : ""} будет удалён из хранилища
              немедленно и безвозвратно, до истечения обычного срока хранения. Действие необратимо.
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
    </div>
  );
}
