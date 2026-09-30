import { useMemo, useState } from "react";
import { PlayCircle, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAsync } from "@/shared/hooks/use-async";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty";
import { ErrorState } from "@/shared/ui/error-state";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";
import { listLessons } from "@/features/lessons/lessons-api.js";
import { RecordingCard } from "./RecordingCard.js";
import { recordingGroupLabel } from "./format.js";
import { listRecordingsForLessons, type LessonRecordingItem } from "./recordings-api.js";

/**
 * «Записи уроков» в кабинете учителя (макет ЛК): только его уроки, по
 * неделям, с фильтром по уроку. Весь архив школы — у администратора
 * (`AdminRecordingsPage`).
 */
export function TeacherRecordingsPage() {
  const { data, error, loading, reload } = useAsync(async () => {
    const { items: lessons } = await listLessons();
    return listRecordingsForLessons(lessons.map((l) => ({ id: l.id, title: l.title })));
  }, []);
  const recordings = useMemo(() => data ?? [], [data]);

  const [lesson, setLesson] = useState<string>("all");
  const [query, setQuery] = useState("");

  const lessonChips = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of recordings) if (!seen.has(r.lessonId)) seen.set(r.lessonId, r.lessonTitle);
    return [...seen].map(([id, title]) => ({ id, title }));
  }, [recordings]);

  const needle = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const out: { label: string; items: LessonRecordingItem[] }[] = [];
    for (const r of recordings) {
      if (lesson !== "all" && r.lessonId !== lesson) continue;
      if (needle && !r.lessonTitle.toLowerCase().includes(needle)) continue;
      const label = recordingGroupLabel(r.startedAt);
      let g = out.find((x) => x.label === label);
      if (!g) out.push((g = { label, items: [] }));
      g.items.push(r);
    }
    return out;
  }, [recordings, lesson, needle]);

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-bold leading-[1.1] tracking-[-0.035em] text-foreground sm:text-[34px]">
            Записи уроков
          </h1>
        </div>
        <label className="relative flex-[1_1_100%] sm:max-w-[260px] sm:flex-[1_1_220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти по уроку"
            aria-label="Найти по уроку"
            className="bg-card pl-9"
          />
        </label>
      </header>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="aspect-[4/3] rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <ErrorState description={error} onRetry={reload} />
      ) : recordings.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-[#d0d5dd] bg-card py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlayCircle />
            </EmptyMedia>
            <EmptyTitle>Записей пока нет</EmptyTitle>
            <EmptyDescription>
              Здесь появляются записи ваших уроков, когда запись готова. Автозапись включается в
              настройках урока — их меняет администратор.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {lessonChips.length > 1 ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Урок">
              {[{ id: "all", title: `Все уроки · ${recordings.length}` }, ...lessonChips].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={lesson === c.id}
                  onClick={() => setLesson(c.id)}
                  className={cn(
                    "h-[34px] whitespace-nowrap rounded-pill border px-3.5 text-[13.5px] font-semibold transition-colors duration-150",
                    lesson === c.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card text-text-2 hover:border-primary-muted",
                  )}
                >
                  {c.title}
                </button>
              ))}
            </div>
          ) : null}

          {groups.length === 0 ? (
            <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-[14.5px] text-text-2">
              Ничего не найдено — попробуйте другое название или выберите «Все уроки».
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.label} className="flex flex-col gap-3.5">
                <h2 className="text-sm font-bold text-text-2">{g.label}</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
                  {g.items.map((r) => (
                    <RecordingCard key={r.id} rec={r} detailed />
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
