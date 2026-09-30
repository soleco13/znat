import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Library, Search } from "lucide-react";
import type { MaterialSource, MaterialSummary } from "@school/shared";

import { cn } from "@/lib/utils";
import { useAsync } from "@/shared/hooks/use-async";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty";
import { ErrorState } from "@/shared/ui/error-state";
import { BrandMark } from "@/shared/ui/brand-mark";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { listMaterials, listMaterialSources } from "./materials-api.js";

const ALL = "__all__";
const NO_TOPIC = "Без темы";

/**
 * Обложка — у `MaterialSummary` нет картинки, поэтому типографская, со
 * знаком Матиса (как в макете). У каждого предмета свой цвет (`assignCovers`),
 * тёмные тона — белый текст читается на всех.
 */
const COVERS = [
  "bg-[#1d4ed8]", // синий
  "bg-[#0f766e]", // бирюзовый
  "bg-[#b45309]", // охра
  "bg-[#be123c]", // малиновый
  "bg-[#1e3a8a]", // тёмно-синий
  "bg-[#4d7c0f]", // оливковый
  "bg-[#0e7490]", // морской
  "bg-[#6d28d9]", // фиолетовый
  "bg-[#9a3412]", // терракота
  "bg-foreground", // чернила
] as const;

/**
 * Школьные предметы — закреплённый цвет, одинаковый во всех вкладках и
 * разный у предметов, которые часто стоят рядом (алгебра/геометрия/физика).
 * Ключ — название в нижнем регистре, как его пишут методисты.
 */
const SUBJECT_COVER: Record<string, number> = {
  "алгебра": 0,
  "математика": 0,
  "геометрия": 1,
  "физика": 4,
  "информатика": 6,
  "химия": 3,
  "биология": 5,
  "география": 2,
  "история": 8,
  "обществознание": 8,
  "русский язык": 7,
  "литература": 7,
  "английский язык": 6,
  "все предметы": 9,
};

/**
 * Цвет обложки предмета: школьные предметы — из `SUBJECT_COVER`, прочие —
 * стабильно по названию (хэш). Одна и та же «алгебра» — один цвет везде.
 */
function assignCovers(subjects: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const subject of subjects) {
    const key = subject.trim().toLowerCase();
    let index = SUBJECT_COVER[key];
    if (index === undefined) {
      let h = 0;
      for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      index = h % COVERS.length;
    }
    out.set(subject, COVERS[index]!);
  }
  return out;
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** «8 класс», «5–9 класс» (подряд), «7, 9 класс». */
function gradesLabel(grades: number[]): string {
  if (grades.length === 0) return "";
  const g = [...grades].sort((a, b) => a - b);
  const contiguous = g.every((v, i) => i === 0 || v === g[i - 1]! + 1);
  if (g.length === 1) return `${g[0]} класс`;
  return contiguous ? `${g[0]}–${g[g.length - 1]} класс` : `${g.join(", ")} класс`;
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function MaterialCard({ material, cover }: { material: MaterialSummary; cover: string }) {
  const updated = new Date(material.updatedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  const meta = [capitalize(material.subject), gradesLabel(material.grades)].filter(Boolean).join(" · ");
  return (
    <Link
      to={`/materials/edit/${material.id}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-[border-color,box-shadow] duration-150 ease-ds hover:border-primary-muted hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div
        className={cn(
          "relative flex aspect-[16/10] flex-col justify-between overflow-hidden px-[18px] py-4 text-white",
          cover,
        )}
      >
        <BrandMark className="pointer-events-none absolute -bottom-10 -right-[34px] size-[150px] text-white opacity-[0.12]" />
        <span className="relative text-xs font-semibold text-white/80">{meta}</span>
        <span className="relative text-balance text-[21px] font-bold leading-[1.15] tracking-[-0.03em]">
          {material.title}
        </span>
      </div>
      <div className="flex items-center gap-2.5 px-[18px] py-3.5">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">Обновлён {updated}</span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[13.5px] font-semibold text-primary" aria-hidden>
          Открыть
          <ArrowRight className="size-4 transition-transform duration-150 ease-ds group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

const SOURCE_HINT: Record<MaterialSource, string> = {
  platform: "Материалы от команды Матиса",
  school: "Опубликованы методистами вашей организации",
};

/**
 * «Библиотека» в кабинете учителя (макет «ЛК учителя»). Вкладки — откуда
 * материалы (`GET /materials/sources`): «Матис» — материалы сервиса, есть
 * всегда, когда служебное пространство заведено; вкладка организации —
 * только если у неё есть опубликованные материалы. Внутри вкладки фильтры
 * и группировка — по реальным полям (предмет, классы, тема), на клиенте.
 * У админа и методиста — прежний `MaterialsLibraryPage`.
 */
export function TeacherLibraryPage() {
  const sourcesAsync = useAsync(() => listMaterialSources(), []);
  const sources = useMemo(() => sourcesAsync.data?.items ?? [], [sourcesAsync.data]);
  const [picked, setPicked] = useState<MaterialSource | null>(null);
  const active = picked ?? sources[0]?.source ?? null;

  const materialsAsync = useAsync(
    () => (active ? listMaterials({ source: active }) : Promise.resolve({ items: [] })),
    [active],
  );
  const { data, reload } = materialsAsync;
  // Смена вкладки: useAsync держит прошлые данные — показываем скелетон, а не чужую вкладку.
  const loading = sourcesAsync.loading || materialsAsync.loading || materialsAsync.refreshing;
  const error = sourcesAsync.error ?? materialsAsync.error;
  const items = useMemo(() => data?.items ?? [], [data]);

  const [subject, setSubject] = useState(ALL);
  const [grade, setGrade] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const subjects = useMemo(
    () => [...new Set(items.map((m) => m.subject))].sort((a, b) => a.localeCompare(b, "ru")),
    [items],
  );
  const coverBySubject = useMemo(() => assignCovers(subjects), [subjects]);
  const grades = useMemo(
    () =>
      [...new Set(items.filter((m) => subject === ALL || m.subject === subject).flatMap((m) => m.grades))].sort(
        (a, b) => a - b,
      ),
    [items, subject],
  );

  const needle = query.trim().toLowerCase();
  const topics = useMemo(() => {
    const out: { topic: string; items: MaterialSummary[] }[] = [];
    for (const m of items) {
      if (subject !== ALL && m.subject !== subject) continue;
      if (grade !== null && !m.grades.includes(grade)) continue;
      if (needle && !m.title.toLowerCase().includes(needle) && !(m.topic ?? "").toLowerCase().includes(needle)) continue;
      const key = m.topic ?? NO_TOPIC;
      let t = out.find((x) => x.topic === key);
      if (!t) out.push((t = { topic: key, items: [] }));
      t.items.push(m);
    }
    // «Без темы» — в конце.
    return out.sort((a, b) => Number(a.topic === NO_TOPIC) - Number(b.topic === NO_TOPIC));
  }, [items, subject, grade, needle]);

  const filtered = subject !== ALL || grade !== null || Boolean(needle);

  function reset() {
    setSubject(ALL);
    setGrade(null);
    setQuery("");
  }

  function pickSource(source: MaterialSource) {
    setPicked(source);
    reset();
  }

  return (
    <div className="flex flex-col">
      {sources.length > 0 ? (
        <Tabs value={active ?? undefined} onValueChange={(v) => pickSource(v as MaterialSource)}>
          <TabsList className="relative z-[1] -mb-px h-auto max-w-full justify-start gap-0.5 overflow-x-auto rounded-none bg-transparent p-0 px-3 [scrollbar-width:none]">
            {sources.map((src) => (
              <TabsTrigger
                key={src.source}
                value={src.source}
                className="h-[42px] max-w-[260px] shrink-0 gap-2.5 rounded-none rounded-t-md border border-b-0 border-transparent px-3.5 pl-3 text-[13.5px] text-text-2 hover:bg-card/60 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:shadow-none"
              >
                {src.source === "platform" ? (
                  <BrandMark className="size-[18px] text-primary" />
                ) : (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-[6px] bg-surface-3 text-[11px] font-bold text-text-2">
                    {src.label.trim()[0]?.toUpperCase()}
                  </span>
                )}
                <span className="truncate">{src.label}</span>
                <span className="text-xs tabular-nums text-text-3">{src.count}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      <div
        className={cn(
          "flex flex-col gap-7 border-border bg-card sm:border sm:p-7",
          sources.length > 0 ? "sm:rounded-[0_18px_18px_18px]" : "sm:rounded-[18px]",
          "-mx-4 border-y px-4 py-6 sm:mx-0",
        )}
      >
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-1.5">
          {active ? <span className="text-[13px] font-semibold text-muted-foreground">{SOURCE_HINT[active]}</span> : null}
          <h1 className="text-[28px] font-bold leading-[1.1] tracking-[-0.035em] text-foreground sm:text-[34px]">
            Библиотека
          </h1>
        </div>
        {items.length > 0 ? (
          <label className="relative flex-[1_1_100%] sm:max-w-[320px] sm:flex-[1_1_220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Название или тема"
              aria-label="Найти материал"
              className="bg-card pl-9"
            />
          </label>
        ) : null}
      </header>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="aspect-[4/3] rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <ErrorState
          description={error}
          onRetry={() => {
            sourcesAsync.reload();
            reload();
          }}
        />
      ) : items.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-[#d0d5dd] bg-card py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Library />
            </EmptyMedia>
            <EmptyTitle>Материалов пока нет</EmptyTitle>
            <EmptyDescription>
              {active === "platform"
                ? "Команда Матиса ещё не опубликовала материалы. Они появятся здесь."
                : "Материалы готовят и публикуют методисты. Опубликованные появятся здесь."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            {subjects.length > 1 ? (
              <Tabs
                value={subject}
                onValueChange={(v) => {
                  setSubject(v);
                  setGrade(null);
                }}
                className="max-w-full"
              >
                <TabsList className="max-w-full justify-start overflow-x-auto [scrollbar-width:none]">
                  <TabsTrigger value={ALL} className="h-8 px-3.5 text-[13.5px]">
                    Все
                  </TabsTrigger>
                  {subjects.map((s) => (
                    <TabsTrigger key={s} value={s} className="h-8 px-3.5 text-[13.5px]">
                      {capitalize(s)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : null}
            {grades.length > 1 ? (
              <div className="flex max-w-full items-center gap-1.5 overflow-x-auto [scrollbar-width:none]" role="group" aria-label="Класс">
                <span className="mr-1 text-[13px] font-semibold text-muted-foreground">Класс</span>
                {grades.map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={grade === g}
                    onClick={() => setGrade(grade === g ? null : g)}
                    className={cn(
                      "h-8 min-w-9 shrink-0 rounded-sm border px-2 text-[13.5px] font-semibold tabular-nums transition-colors duration-150",
                      grade === g
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card text-text-2 hover:border-primary-muted",
                    )}
                  >
                    {g}
                  </button>
                ))}
              </div>
            ) : null}
            {filtered ? (
              <button
                type="button"
                onClick={reset}
                className="h-8 rounded-sm px-2.5 text-[13.5px] font-semibold text-primary transition-colors hover:bg-accent"
              >
                Сбросить
              </button>
            ) : null}
          </div>

          {topics.length === 0 ? (
            <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-[14.5px] text-text-2">
              Ничего не найдено — попробуйте другое название или сбросьте фильтры.
            </div>
          ) : (
            topics.map((t) => (
              <section key={t.topic} className="flex flex-col gap-3.5">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                  <h2 className="text-lg font-bold tracking-[-0.02em] text-foreground">{t.topic}</h2>
                  <span className="whitespace-nowrap text-[13px] text-text-3">
                    {t.items.length} {plural(t.items.length, ["материал", "материала", "материалов"])}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
                  {t.items.map((m) => (
                    <MaterialCard key={m.id} material={m} cover={coverBySubject.get(m.subject) ?? COVERS[0]} />
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}
      </div>
    </div>
  );
}
