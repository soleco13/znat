import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Link2,
  MoreHorizontal,
  PlayCircle,
  Search,
  Users,
} from "lucide-react";
import type { LessonMaterial, LessonSummary } from "@school/shared";

import { useAsync } from "@/shared/hooks/use-async";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty";
import { ErrorState } from "@/shared/ui/error-state";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/sonner";
import { RecordingCard } from "@/features/recordings/RecordingCard.js";
import {
  listRecordingsForLessons,
  type LessonRecordingItem,
} from "@/features/recordings/recordings-api.js";
import { getPresenceCounts, listLessonMaterials, listLessons } from "./lessons-api.js";
import { AttendanceDialog, LessonMaterialsDialog } from "./lesson-dialogs.js";

/** Сколько человек в комнате — обновляем, пока кабинет открыт. */
const PRESENCE_POLL_MS = 30_000;

async function copyJoinLink(joinPath: string) {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}${joinPath}`);
    toast.success("Ссылка для учеников скопирована");
  } catch {
    toast.error("Не удалось скопировать ссылку");
  }
}

/** Русское склонение: plural(3, ["материал", "материала", "материалов"]). */
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

const materialsLabel = (n: number) =>
  n === 0 ? "нет материалов" : `${n} ${plural(n, ["материал", "материала", "материалов"])}`;
const recordingsLabel = (n: number) =>
  n === 0 ? "нет записей" : `${n} ${plural(n, ["запись", "записи", "записей"])}`;

// ─────────────────────────────────────────────────────────────────────────────

/** Плитка урока: вся плитка — переход в урок; ссылка для учеников и меню — поверх. */
function LessonTile({
  lesson,
  presence,
  materials,
  recordings,
  onAttendance,
  onMaterials,
}: {
  lesson: LessonSummary;
  presence: number;
  materials: number | undefined;
  recordings: number | undefined;
  onAttendance: () => void;
  onMaterials: () => void;
}) {
  return (
    <article className="group relative flex min-h-[176px] flex-col rounded-lg border border-border bg-card px-[22px] pb-[18px] pt-5 shadow-xs transition-[border-color,box-shadow] duration-150 ease-ds focus-within:border-primary-muted hover:border-primary-muted hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        {/* Растянутая ссылка заголовка делает кликабельной всю плитку — без вложенных интерактивных элементов. */}
        <Link
          to={`/lessons/${lesson.id}/room`}
          className="text-pretty text-[19px] font-bold leading-tight tracking-[-0.025em] text-foreground after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none"
        >
          {lesson.title}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" className="relative z-10 -mr-1.5 -mt-1" aria-label="Действия с уроком">
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onAttendance}>
              <Users aria-hidden />
              Журнал посещений
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onMaterials}>
              <BookOpen aria-hidden />
              Материалы урока
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pb-4 pt-5 text-[12.5px] tabular-nums text-text-2">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <BookOpen className="size-3.5 text-text-3" aria-hidden />
          {materials == null ? <Skeleton className="h-3 w-16" /> : materialsLabel(materials)}
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <PlayCircle className="size-3.5 text-text-3" aria-hidden />
          {recordings == null ? <Skeleton className="h-3 w-14" /> : recordingsLabel(recordings)}
        </span>
        {presence > 0 ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-success">
            <Users className="size-3.5" aria-hidden />
            {presence} в комнате
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-surface-3 pt-3.5">
        <Button
          size="sm"
          variant="ghost"
          className="relative z-10 -ml-2.5"
          onClick={() => void copyJoinLink(lesson.joinPath)}
        >
          <Link2 aria-hidden />
          Ссылка для учеников
        </Button>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-primary" aria-hidden>
          Войти
          <ArrowRight className="size-4 transition-transform duration-150 ease-ds group-hover:translate-x-0.5" />
        </span>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * «Уроки» в кабинете учителя (макет ЛК): плитки его уроков, клик — сразу в
 * урок. У админа — прежний `LessonsListPage` (выбор — в App.tsx).
 */
export function TeacherLessonsPage() {
  const { data, error, loading, reload } = useAsync(() => listLessons(), []);
  const lessons = useMemo(() => data?.items ?? [], [data]);

  // Присутствие, материалы и записи — отдельными запросами, чтобы не
  // тормозить сам список уроков: плитки появляются сразу, цифры — следом.
  const lessonIdsKey = lessons.map((l) => l.id).join(",");
  const presenceAsync = useAsync(
    () => getPresenceCounts(lessonIdsKey ? lessonIdsKey.split(",") : []),
    [lessonIdsKey],
  );
  const presence = presenceAsync.data ?? {};
  const reloadPresence = presenceAsync.reload;
  useEffect(() => {
    if (!lessonIdsKey) return;
    const timer = window.setInterval(reloadPresence, PRESENCE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [lessonIdsKey, reloadPresence]);

  const materialsAsync = useAsync(async () => {
    const ids = lessonIdsKey ? lessonIdsKey.split(",") : [];
    const results = await Promise.allSettled(ids.map((id) => listLessonMaterials(id)));
    const map: Record<string, LessonMaterial[]> = {};
    results.forEach((res, i) => {
      if (res.status === "fulfilled") map[ids[i]!] = res.value.items;
    });
    return map;
  }, [lessonIdsKey]);
  // При смене набора уроков useAsync держит старые данные — пока идёт
  // перезагрузка, показываем скелетон, а не «нет материалов».
  const materials = materialsAsync.refreshing ? null : materialsAsync.data;
  const setMaterials = materialsAsync.setData;

  const recordingsAsync = useAsync(
    () => listRecordingsForLessons(lessons.map((l) => ({ id: l.id, title: l.title }))),
    [lessonIdsKey],
  );
  const recordings = recordingsAsync.refreshing ? null : recordingsAsync.data;
  const recordingsByLesson = useMemo(() => {
    const map: Record<string, LessonRecordingItem[]> = {};
    for (const r of recordings ?? []) (map[r.lessonId] ??= []).push(r);
    return map;
  }, [recordings]);

  const [query, setQuery] = useState("");
  const [attendanceFor, setAttendanceFor] = useState<LessonSummary | null>(null);
  const [materialsFor, setMaterialsFor] = useState<LessonSummary | null>(null);

  const needle = query.trim().toLowerCase();
  const visible = lessons.filter((l) => !needle || l.title.toLowerCase().includes(needle));
  const recent = (recordings ?? []).filter((r) => r.status === "ready").slice(0, 4);

  return (
    <div className="flex flex-col gap-8 lg:gap-9">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <h1 className="text-[28px] font-bold leading-[1.1] tracking-[-0.035em] text-foreground sm:text-[34px]">
          Уроки
        </h1>
        <div className="flex flex-[1_1_320px] flex-wrap items-center justify-end gap-2.5">
          {lessons.length > 0 ? (
            <label className="relative flex-[1_1_100%] sm:max-w-[260px] sm:flex-[1_1_220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Найти урок"
                aria-label="Найти урок"
                className="bg-card pl-9"
              />
            </label>
          ) : null}
        </div>
      </header>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-[176px] rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <ErrorState description={error} onRetry={reload} />
      ) : lessons.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-[#d0d5dd] bg-card py-[72px]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarDays />
            </EmptyMedia>
            <EmptyTitle>Уроков пока нет</EmptyTitle>
            <EmptyDescription>
              Уроки создаёт администратор. Как только за вами закрепят урок, он появится здесь.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {visible.length === 0 ? (
            <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-[14.5px] text-text-2">
              Ничего не найдено — попробуйте другое название.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
              {visible.map((lesson) => (
                <LessonTile
                  key={lesson.id}
                  lesson={lesson}
                  presence={presence[lesson.id] ?? 0}
                  materials={materials ? (materials[lesson.id]?.length ?? 0) : undefined}
                  recordings={recordings ? (recordingsByLesson[lesson.id]?.length ?? 0) : undefined}
                  onAttendance={() => setAttendanceFor(lesson)}
                  onMaterials={() => setMaterialsFor(lesson)}
                />
              ))}
            </div>
          )}

          {recent.length > 0 ? (
            <section className="flex flex-col gap-[18px]">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[21px] font-bold tracking-[-0.025em] text-foreground">Последние записи</h2>
                <Link
                  to="/recordings"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary-hover"
                >
                  Все записи
                  <ArrowRight className="size-[15px]" aria-hidden />
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
                {recent.map((r) => (
                  <RecordingCard key={r.id} rec={r} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      <AttendanceDialog lesson={attendanceFor} onClose={() => setAttendanceFor(null)} />
      <LessonMaterialsDialog
        lesson={materialsFor}
        onClose={() => setMaterialsFor(null)}
        onChanged={(id, items) => setMaterials((prev) => ({ ...(prev ?? {}), [id]: items }))}
      />

    </div>
  );
}
