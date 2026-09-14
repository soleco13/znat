import { useState } from "react";
import { Download, HardDrive, Link2, Trash2, Video } from "lucide-react";
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
import { EmptyState } from "@/shared/ui/empty-state";
import { ErrorState } from "@/shared/ui/error-state";
import { PageHeader } from "@/shared/ui/page-header";
import { Progress } from "@/shared/ui/progress";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";
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

const STATUS_LABEL: Record<RecordingStatus, string> = {
  starting: "запускается",
  recording: "идёт запись",
  processing: "обрабатывается",
  ready: "готова",
  failed: "сбой",
  aborted: "прервана",
  deleted: "удалена",
};

const STATUS_VARIANT: Record<RecordingStatus, "blue" | "green" | "yellow" | "red" | "gray"> = {
  starting: "yellow",
  recording: "red",
  processing: "yellow",
  ready: "green",
  failed: "red",
  aborted: "gray",
  deleted: "gray",
};

const PAGE_SIZE = 20;

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} ГБ`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} МБ`;
}

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

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

export function AdminRecordingsPage() {
  const [page, setPage] = useState(1);
  const { data, error, loading, refreshing, reload, setData } = useAsync(
    () => listAllRecordings(page, PAGE_SIZE),
    [page],
  );
  const [deleteFor, setDeleteFor] = useState<AdminRecordingSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkBusyId, setLinkBusyId] = useState<string | null>(null);

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
    if (!deleteFor || !data) return;
    setBusy(true);
    try {
      await adminDeleteRecording(deleteFor.id);
      setData({
        ...data,
        items: data.items.map((r) =>
          r.id === deleteFor.id
            ? { ...r, status: "deleted" as const, url: null, sizeBytes: null }
            : r,
        ),
      });
      toast.success("Запись удалена из хранилища");
      setDeleteFor(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось удалить запись");
    } finally {
      setBusy(false);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

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
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
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
              {data.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[220px] truncate font-medium text-foreground">
                    {r.lessonTitle}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.teacherName}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(r.startedAt)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDuration(r.durationSec)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.sizeBytes != null ? formatBytes(r.sizeBytes) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
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
                      {r.status !== "deleted" && r.status !== "starting" && r.status !== "recording" ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Удалить запись"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteFor(r)}
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
      ) : (
        <EmptyState icon={Video} title="Записей пока нет" description="Записи уроков появятся здесь." />
      )}

      {data && totalPages > 1 ? (
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

      <AlertDialog open={Boolean(deleteFor)} onOpenChange={(v) => !v && setDeleteFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить запись «{deleteFor?.lessonTitle}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Файл будет удалён из хранилища немедленно и безвозвратно, до истечения обычного срока
              хранения. Действие необратимо.
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
