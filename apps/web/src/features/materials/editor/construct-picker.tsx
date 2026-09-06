import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { MATERIAL_CONSTRUCTS, type MaterialConstruct } from "../material-templates.js";

/** Диалог-пикер конструкций — визуальные карточки (Э13). */
export function ConstructPickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (construct: MaterialConstruct) => void;
}) {
  const groups = MATERIAL_CONSTRUCTS.filter((c) => c.kind === "group");
  const singles = MATERIAL_CONSTRUCTS.filter((c) => c.kind === "block");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Конструкции</DialogTitle>
          <DialogDescription>
            Готовые каркасы уроков и блоки-заготовки. Вставятся в лист — останется заменить текст.
          </DialogDescription>
        </DialogHeader>

        <section className="mb-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-3">Каркасы</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {groups.map((c) => (
              <ConstructCard key={c.id} construct={c} onPick={() => onPick(c)} />
            ))}
          </div>
        </section>
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-3">
            Готовые блоки
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {singles.map((c) => (
              <ConstructCard key={c.id} construct={c} onPick={() => onPick(c)} />
            ))}
          </div>
        </section>
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
