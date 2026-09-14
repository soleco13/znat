import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Download,
  HardDrive,
  Link2,
  Loader2,
  Trash2,
  User,
} from "lucide-react";

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
import { ErrorState } from "@/shared/ui/error-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/sonner";
import {
  formatBytes,
  formatDate,
  formatDuration,
  isDeletable,
  STATUS_LABEL,
  STATUS_VARIANT,
} from "./format.js";
import { adminDeleteRecording, createExternalDownloadLink, getRecording } from "./recordings-api.js";

/**
 * Пользовательский запрос (2026-09-14): отдельная страница просмотра одной
 * записи — вместо голой ссылки на .mp4 в новой вкладке. Свой видеоплеер в
 * стиле приложения, с анимированным лоадером буферизации (было: браузер
 * просто показывал пустой чёрный кадр без какой-либо индикации).
 */
export function RecordingViewerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(() => getRecording(id!), [id]);
  const [buffering, setBuffering] = useState(true);
  const [linkBusy, setLinkBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  async function copyExternalLink() {
    if (!data) return;
    setLinkBusy(true);
    try {
      const link = await createExternalDownloadLink(data.id);
      await navigator.clipboard.writeText(link.url);
      toast.success("Внешняя ссылка скопирована — действует 24 часа");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось создать ссылку");
    } finally {
      setLinkBusy(false);
    }
  }

  async function handleDelete() {
    if (!data) return;
    setDeleteBusy(true);
    try {
      await adminDeleteRecording(data.id);
      toast.success("Запись удалена из хранилища");
      navigate("/admin/recordings");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось удалить запись");
      setDeleteBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate("/admin/recordings")}>
        <ArrowLeft aria-hidden />
        К списку записей
      </Button>

      {loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="aspect-video w-full rounded-lg" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      ) : error || !data ? (
        <ErrorState description={error ?? "Запись не найдена"} onRetry={reload} />
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="ds-page-title truncate">{data.lessonTitle}</h1>
              <p className="ds-page-subtitle mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <User className="size-3.5" aria-hidden /> {data.teacherName}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="size-3.5" aria-hidden /> {formatDate(data.startedAt)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-3.5" aria-hidden /> {formatDuration(data.durationSec)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <HardDrive className="size-3.5" aria-hidden /> {formatBytes(data.sizeBytes)}
                </span>
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2.5">
              {data.url ? (
                <Button asChild variant="outline" size="sm">
                  <a href={data.url} target="_blank" rel="noreferrer">
                    <Download aria-hidden />
                    Скачать
                  </a>
                </Button>
              ) : null}
              {data.status === "ready" ? (
                <Button variant="outline" size="sm" onClick={() => void copyExternalLink()} loading={linkBusy}>
                  <Link2 aria-hidden />
                  Внешняя ссылка
                </Button>
              ) : null}
              {isDeletable(data.status) ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 aria-hidden />
                  Удалить
                </Button>
              ) : null}
            </div>
          </div>

          {data.url ? (
            <Card className="relative overflow-hidden bg-slate-950 p-0">
              <div className="relative aspect-video w-full">
                <video
                  ref={videoRef}
                  key={data.url}
                  src={data.url}
                  controls
                  className="absolute inset-0 size-full"
                  onWaiting={() => setBuffering(true)}
                  onPlaying={() => setBuffering(false)}
                  onCanPlay={() => setBuffering(false)}
                  onLoadedData={() => setBuffering(false)}
                  onError={() => setBuffering(false)}
                />
                {buffering ? (
                  <div
                    role="status"
                    className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-slate-950/70"
                  >
                    <span className="relative inline-flex items-center justify-center">
                      <span
                        className="absolute inset-0 animate-ping rounded-full bg-primary/40"
                        style={{ animationDuration: "1.4s" }}
                        aria-hidden
                      />
                      <span className="relative flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/25">
                        <Loader2 className="size-6 animate-spin" aria-hidden />
                      </span>
                    </span>
                    <span className="text-xs font-medium text-white/70">Видео загружается…</span>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : (
            <ErrorState
              title="Файл недоступен"
              description="Запись ещё не готова или уже удалена из хранилища."
            />
          )}

          <Card className="mt-4 p-4">
            <h2 className="ds-label mb-3">Сведения о записи</h2>
            <dl className="grid grid-cols-2 gap-y-2.5 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Статус</dt>
                <dd className="mt-0.5">
                  <Badge variant={STATUS_VARIANT[data.status]}>{STATUS_LABEL[data.status]}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Начало</dt>
                <dd className="mt-0.5 font-medium text-foreground">{formatDate(data.startedAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Окончание</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {data.endedAt ? formatDate(data.endedAt) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Хранится до</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {data.expiresAt ? formatDate(data.expiresAt) : "—"}
                </dd>
              </div>
            </dl>
          </Card>
        </>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить запись «{data?.lessonTitle}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Файл будет удалён из хранилища немедленно и безвозвратно, до истечения обычного срока
              хранения. Действие необратимо.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteBusy}
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
