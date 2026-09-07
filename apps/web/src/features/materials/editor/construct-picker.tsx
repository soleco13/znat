import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  CONSTRUCT_SUBJECT_ORDER,
  MATERIAL_CONSTRUCTS,
  type MaterialConstruct,
} from "../material-templates.js";

/**
 * Диалог-пикер конструкций (Э13, доп. «внедряй всё» — конструкции по
 * школьным предметам, не только математика). ~70 карточек плоским списком
 * нечитаемы, поэтому: поиск по названию/описанию/предмету + группировка
 * по `subject` в порядке `CONSTRUCT_SUBJECT_ORDER` (неизвестные предметы —
 * отдельным разделом в конце, на будущее).
 */
export function ConstructPickerDialog({
  open,
  onOpenChange,
  onPick,
  initialQuery,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (construct: MaterialConstruct) => void;
  /** Текст, уже напечатанный методистом после «/» до выбора «Конструкции…» — предзаполняет поиск, чтобы не печатать второй раз. */
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery ?? "");

  // Каждое открытие диалога может прийти с новым initialQuery (другой
  // запуск «/конструкция…») — синхронизируем поиск на открытии, но не
  // мешаем методисту печатать в уже открытой модалке.
  useEffect(() => {
    if (open) setQuery(initialQuery ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const bySubject = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? MATERIAL_CONSTRUCTS.filter(
          (c) =>
            c.label.toLowerCase().includes(q) ||
            c.description.toLowerCase().includes(q) ||
            c.subject.toLowerCase().includes(q) ||
            c.triggers.some((t) => t.includes(q)),
        )
      : MATERIAL_CONSTRUCTS;

    const map = new Map<string, MaterialConstruct[]>();
    for (const c of filtered) {
      const list = map.get(c.subject) ?? [];
      list.push(c);
      map.set(c.subject, list);
    }
    const knownOrder = CONSTRUCT_SUBJECT_ORDER.filter((s) => map.has(s));
    const extra = [...map.keys()].filter((s) => !(CONSTRUCT_SUBJECT_ORDER as readonly string[]).includes(s));
    return [...knownOrder, ...extra].map((subject) => ({ subject, items: map.get(subject)! }));
  }, [query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Конструкции</DialogTitle>
          <DialogDescription>
            Готовые каркасы уроков и блоки-заготовки по школьным предметам. Вставятся в лист — останется заменить текст.
          </DialogDescription>
        </DialogHeader>

        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по конструкциям и предметам…"
            className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>

        <div className="-mx-1 overflow-y-auto px-1">
          {bySubject.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Ничего не найдено.</p>
          )}
          {bySubject.map(({ subject, items }) => (
            <section key={subject} className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-3">{subject}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((c) => (
                  <ConstructCard key={c.id} construct={c} onPick={() => onPick(c)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConstructCard({
  construct,
  onPick,
}: {
  construct: MaterialConstruct;
  onPick: () => void;
}) {
  const Icon = construct.icon;
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-accent"
    >
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="text-sm font-semibold text-foreground">{construct.label}</span>
      </div>
      <p className="text-xs text-muted-foreground">{construct.description}</p>
      <div className="flex flex-wrap gap-1">
        {construct.outline.map((step, i) => (
          <span
            key={i}
            className="rounded-pill bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            {step}
          </span>
        ))}
      </div>
    </button>
  );
}
