import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  FileUp,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  ContentBlock,
  Material,
  MaterialBlock,
  MaterialStatus,
  MaterialValidationIssue,
  MaterialVersionSummary,
  QuestionBlock,
  QuestionInteraction,
  QuestionResponse,
} from "@school/shared";
import { IMPORT_MAX_QUESTIONS, stripMaterialAnswerKeys } from "@school/shared";

import { cn } from "@/lib/utils";
import { useAuthStore } from "@/shared/auth-store";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { Textarea } from "@/shared/ui/textarea";
import { toast } from "@/shared/ui/sonner";
import { ContentBlockView } from "./MaterialPlayer.js";
import { QuestionPlayer } from "./QuestionPlayer.js";
import { RichTextEditor } from "./RichTextEditor.js";
import { FormulaEditor } from "./FormulaEditor.js";
import { InteractionEditor } from "./QuestionInteractionEditors.js";
import { MediaAssetPicker } from "./MediaAssetPicker.js";
import { CONTENT_BLOCK_LABELS, INTERACTION_LABELS, createBlock } from "./block-factories.js";
import {
  getMaterial,
  getMaterialVersions,
  importQuestionsFromDocument,
  publishMaterial,
  returnMaterialToDraft,
  submitMaterialForReview,
  validateMaterial,
} from "./materials-api.js";
import { type AutosaveStatus, useMaterialAutosave } from "./useMaterialAutosave.js";

const STATUS_META: Record<MaterialStatus, { label: string; variant: "gray" | "yellow" | "green" }> = {
  draft: { label: "Черновик", variant: "gray" },
  review: { label: "На ревью", variant: "yellow" },
  published: { label: "Опубликован", variant: "green" },
};

/**
 * Редактор материала (Э9.2–9.11). Три панели: список блоков / редактирование /
 * живое превью глазами ученика. Автосохранение, переходы статуса, валидатор,
 * импорт из Word/PDF. Стоп-лист Э9: методисту нигде не показывается сырой JSON.
 */
export function MaterialEditorPage() {
  const { id } = useParams<{ id: string }>();
  const currentUser = useAuthStore((s) => s.user);
  const [material, setMaterial] = useState<Material | null>(null);
  const [status, setStatus] = useState<MaterialStatus | null>(null);
  const [createdBy, setCreatedBy] = useState<string | null>(null);
  const [isCurrent, setIsCurrent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<MaterialValidationIssue[] | null>(null);
  const justLoaded = useRef(false);

  const canEdit = currentUser?.role !== "teacher" || createdBy === currentUser?.id;
  const autosave = useMaterialAutosave(id ?? null, canEdit);

  async function runValidation(): Promise<MaterialValidationIssue[]> {
    if (!id) return [];
    const res = await validateMaterial(id);
    setValidationIssues(res.items);
    return res.items;
  }

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    justLoaded.current = true;
    getMaterial(id)
      .then((detail) => {
        if (cancelled) return;
        setMaterial(detail.material);
        setStatus(detail.status);
        setCreatedBy(detail.createdBy);
        setIsCurrent(detail.isCurrent);
        setSelectedBlockId(detail.material.blocks[0]?.id ?? null);
      })
      .catch(() => !cancelled && setError("Не удалось загрузить материал"));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!material) return;
    if (justLoaded.current) {
      justLoaded.current = false;
      return;
    }
    autosave.queue(material);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="mb-2 text-sm font-medium text-destructive">{error}</p>
        <Link to="/materials" className="text-sm text-muted-foreground hover:underline">
          ← Назад в библиотеку
        </Link>
      </div>
    );
  }
  if (!material) return <CenteredSpinner label="Загрузка материала…" />;

  function updateBlock(blockId: string, updater: (block: MaterialBlock) => MaterialBlock) {
    setMaterial((prev) =>
      prev ? { ...prev, blocks: prev.blocks.map((b) => (b.id === blockId ? updater(b) : b)) } : prev,
    );
  }

  function addBlock(makeBlock: () => MaterialBlock) {
    const block = makeBlock();
    setMaterial((prev) => (prev ? { ...prev, blocks: [...prev.blocks, block] } : prev));
    setSelectedBlockId(block.id);
  }

  function addBlocks(newBlocks: MaterialBlock[]) {
    if (newBlocks.length === 0) return;
    setMaterial((prev) => (prev ? { ...prev, blocks: [...prev.blocks, ...newBlocks] } : prev));
    setSelectedBlockId(newBlocks[0]!.id);
  }

  function removeBlock(blockId: string) {
    setMaterial((prev) =>
      prev ? { ...prev, blocks: prev.blocks.filter((b) => b.id !== blockId) } : prev,
    );
    setSelectedBlockId((prev) => (prev === blockId ? null : prev));
  }

  function reorderBlocks(fromIndex: number, toIndex: number) {
    setMaterial((prev) =>
      prev ? { ...prev, blocks: arrayMove(prev.blocks, fromIndex, toIndex) } : prev,
    );
  }

  const selectedBlock = material.blocks.find((b) => b.id === selectedBlockId) ?? null;

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/materials"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            <ChevronLeft className="size-3.5" aria-hidden /> Библиотека
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="ds-page-title truncate">{material.title}</h1>
            {status ? <Badge variant={STATUS_META[status].variant}>{STATUS_META[status].label}</Badge> : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <p
            className={cn(
              "text-xs",
              canEdit ? "text-muted-foreground" : "font-medium text-warning",
            )}
          >
            {canEdit
              ? autosaveLabel(autosave.status)
              : "Материал не ваш — только просмотр"}
          </p>
          {id && status && (
            <StatusActions
              materialId={id}
              status={status}
              isCurrent={isCurrent}
              canEdit={canEdit}
              role={currentUser?.role ?? null}
              onFlushPending={() => autosave.flush()}
              onStatusChange={setStatus}
              onPublished={() => setIsCurrent(true)}
              onValidate={runValidation}
            />
          )}
        </div>
      </header>

      {canEdit && id && <VersionHistory materialId={id} />}
      {canEdit && (
        <ValidationPanel
          issues={validationIssues}
          onRefresh={runValidation}
          onSelectBlock={setSelectedBlockId}
        />
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_1fr_1fr]">
        <BlockListPanel
          blocks={material.blocks}
          selectedBlockId={selectedBlockId}
          onSelect={setSelectedBlockId}
          onAdd={addBlock}
          onAddMany={addBlocks}
          onRemove={removeBlock}
          onReorder={reorderBlocks}
        />
        <BlockEditorPanel block={selectedBlock} onChange={updateBlock} />
        <LivePreviewPanel material={material} />
      </div>
    </div>
  );
}

function StatusActions({
  materialId,
  status,
  isCurrent,
  canEdit,
  role,
  onFlushPending,
  onStatusChange,
  onPublished,
  onValidate,
}: {
  materialId: string;
  status: MaterialStatus;
  isCurrent: boolean;
  canEdit: boolean;
  role: string | null;
  onFlushPending: () => Promise<void> | void;
  onStatusChange: (status: MaterialStatus) => void;
  onPublished: () => void;
  onValidate: () => Promise<MaterialValidationIssue[]>;
}) {
  const [pending, setPending] = useState(false);
  const isStaff = role === "admin" || role === "methodist";

  async function run(action: () => Promise<void>) {
    setPending(true);
    try {
      await onFlushPending();
      await action();
    } catch {
      toast.error("Не получилось — попробуйте ещё раз");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {canEdit && status === "draft" && (
        <Button
          variant="outline"
          size="sm"
          loading={pending}
          onClick={() =>
            run(async () => onStatusChange((await submitMaterialForReview(materialId)).status))
          }
        >
          Отправить на ревью
        </Button>
      )}
      {isStaff && status === "review" && (
        <Button
          variant="outline"
          size="sm"
          loading={pending}
          onClick={() =>
            run(async () => onStatusChange((await returnMaterialToDraft(materialId)).status))
          }
        >
          Вернуть в черновик
        </Button>
      )}
      {isStaff && !isCurrent && (
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            run(async () => {
              const issues = await onValidate();
              if (issues.length > 0) {
                toast.error(
                  `Материал не готов к публикации — проблем: ${issues.length}. Смотрите «Валидация».`,
                );
                return;
              }
              await publishMaterial(materialId);
              onStatusChange("published");
              onPublished();
              toast.success("Материал опубликован");
            })
          }
        >
          Опубликовать
        </Button>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  badge,
  children,
  onOpen,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3 rounded-lg border border-border bg-card text-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-muted-foreground"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => {
            if (!v) onOpen?.();
            return !v;
          });
        }}
      >
        <span className="flex items-center gap-2">
          {title}
          {badge}
        </span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? <div className="border-t border-border p-3">{children}</div> : null}
    </div>
  );
}

function VersionHistory({ materialId }: { materialId: string }) {
  const [items, setItems] = useState<MaterialVersionSummary[] | null>(null);

  function load() {
    if (items !== null) return;
    getMaterialVersions(materialId)
      .then((res) => setItems(res.items))
      .catch(() => setItems([]));
  }

  return (
    <CollapsibleSection title="История версий" onOpen={load}>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {items === null && <li>Загрузка…</li>}
        {items?.length === 0 && <li>Версий пока нет</li>}
        {items?.map((v) => (
          <li key={v.versionId}>
            Версия {v.version} — {new Date(v.createdAt).toLocaleString("ru-RU")}
            {v.isCurrent && <span className="ml-1 font-medium text-success">(опубликована сейчас)</span>}
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  );
}

const VALIDATION_ISSUE_LABELS: Record<MaterialValidationIssue["code"], string> = {
  material_empty: "Материал пуст",
  empty_content: "Пустой блок",
  no_correct_answer: "Нет правильного ответа",
  zero_points: "0 баллов",
  broken_asset: "Битый файл",
};

function ValidationPanel({
  issues,
  onRefresh,
  onSelectBlock,
}: {
  issues: MaterialValidationIssue[] | null;
  onRefresh: () => Promise<MaterialValidationIssue[]>;
  onSelectBlock: (blockId: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      await onRefresh();
    } finally {
      setLoading(false);
    }
  }

  const badge =
    issues === null ? null : issues.length === 0 ? (
      <Badge variant="green">готов к публикации</Badge>
    ) : (
      <Badge variant="yellow">{issues.length}</Badge>
    );

  return (
    <CollapsibleSection title="Валидация" badge={badge}>
      <Button variant="outline" size="sm" className="mb-2" onClick={refresh} loading={loading}>
        {loading ? "Проверка…" : "Проверить"}
      </Button>
      {issues === null && <p className="text-xs text-muted-foreground">Ещё не проверялся</p>}
      {issues?.length === 0 && <p className="text-xs text-success">Проблем не найдено</p>}
      {issues && issues.length > 0 && (
        <ul className="space-y-1 text-xs">
          {issues.map((issue, i) => (
            <li key={i}>
              {issue.blockId ? (
                <button
                  type="button"
                  onClick={() => onSelectBlock(issue.blockId!)}
                  className="text-left text-primary underline"
                >
                  [{VALIDATION_ISSUE_LABELS[issue.code]}] {issue.message}
                </button>
              ) : (
                <span>
                  [{VALIDATION_ISSUE_LABELS[issue.code]}] {issue.message}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}

function autosaveLabel(status: AutosaveStatus): string {
  switch (status) {
    case "saving":
      return "сохранение…";
    case "saved":
      return "сохранено";
    case "error":
      return "не сохранено — повторим";
    case "idle":
      return "черновик";
  }
}

// ─── Панель 1: список блоков ────────────────────────────────────────────────

function blockLabel(block: MaterialBlock): string {
  return block.type === "question"
    ? `Вопрос: ${INTERACTION_LABELS[block.interaction.type]}`
    : CONTENT_BLOCK_LABELS[block.type];
}

function blockPreviewText(block: MaterialBlock): string {
  const html = block.type === "question" ? block.prompt.html : "html" in block ? block.html : "";
  const text = html.replace(/<[^>]+>/g, "").trim();
  return text || "(пусто)";
}

function BlockListPanel({
  blocks,
  selectedBlockId,
  onSelect,
  onAdd,
  onAddMany,
  onRemove,
  onReorder,
}: {
  blocks: MaterialBlock[];
  selectedBlockId: string | null;
  onSelect: (id: string) => void;
  onAdd: (makeBlock: () => MaterialBlock) => void;
  onAddMany: (blocks: MaterialBlock[]) => void;
  onRemove: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = blocks.map((b) => b.id);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = ids.indexOf(String(active.id));
    const toIndex = ids.indexOf(String(over.id));
    if (fromIndex === -1 || toIndex === -1) return;
    onReorder(fromIndex, toIndex);
  }

  return (
    <div className="flex flex-col self-start rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
        Блоки ({blocks.length})
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
            {blocks.map((block, i) => (
              <SortableBlockItem
                key={block.id}
                block={block}
                index={i}
                total={blocks.length}
                selected={block.id === selectedBlockId}
                onSelect={() => onSelect(block.id)}
                onMove={(direction) => onReorder(i, i + direction)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {blocks.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          Материал пуст — добавьте первый блок
        </p>
      )}
      {selectedBlockId && (
        <button
          onClick={() => onRemove(selectedBlockId)}
          className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-xs font-medium text-destructive transition-colors hover:bg-destructive/5"
        >
          <Trash2 className="size-3.5" aria-hidden /> Удалить выбранный блок
        </button>
      )}
      <AddBlockMenu onAdd={onAdd} />
      <ImportFromDocument onImported={onAddMany} />
    </div>
  );
}

function ImportFromDocument({ onImported }: { onImported: (blocks: MaterialBlock[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await importQuestionsFromDocument(file);
      if (result.blocks.length === 0) {
        setMessage("В файле не нашлось текста — блоки не добавлены");
      } else {
        onImported(result.blocks);
        setMessage(
          `Добавлено блоков: ${result.blocks.length}${result.truncated ? ` (лимит ${IMPORT_MAX_QUESTIONS}, часть документа не учтена)` : ""} — проверьте и поправьте вручную`,
        );
      }
    } catch {
      setMessage("Не удалось разобрать файл (поддерживаются .docx и .pdf)");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-border p-2">
      <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <FileUp className="size-3.5" aria-hidden />
        {busy ? "Распознавание…" : "Импортировать из Word/PDF"}
        <input type="file" accept=".docx,.pdf" onChange={handleFile} disabled={busy} className="hidden" />
      </label>
      {message && <p className="mt-1 text-[11px] text-muted-foreground">{message}</p>}
    </div>
  );
}

function SortableBlockItem({
  block,
  index,
  total,
  selected,
  onSelect,
  onMove,
}: {
  block: MaterialBlock;
  index: number;
  total: number;
  selected: boolean;
  onSelect: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-1",
        isDragging && "opacity-50",
        selected && "bg-accent",
      )}
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab select-none px-1 text-muted-foreground"
        aria-hidden="true"
      >
        <GripVertical className="size-3.5" />
      </span>
      <button
        onClick={onSelect}
        className={cn(
          "flex flex-1 flex-col items-start gap-0.5 px-1 py-2 text-left",
          !selected && "hover:bg-secondary",
        )}
      >
        <span className="text-[11px] font-medium text-muted-foreground">
          {index + 1}. {blockLabel(block)}
        </span>
        <span className="truncate text-sm text-foreground">{blockPreviewText(block)}</span>
      </button>
      <span className="flex flex-col gap-0.5 pr-1">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          aria-label="Переместить блок выше"
          className="rounded border border-border p-0.5 text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-30"
        >
          <ChevronUp className="size-3" />
        </button>
        <button
          type="button"
          disabled={index === total - 1}
          onClick={() => onMove(1)}
          aria-label="Переместить блок ниже"
          className="rounded border border-border p-0.5 text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-30"
        >
          <ChevronDown className="size-3" />
        </button>
      </span>
    </li>
  );
}

function AddBlockMenu({ onAdd }: { onAdd: (makeBlock: () => MaterialBlock) => void }) {
  return (
    <div className="border-t border-border p-2">
      <Label className="mb-1 block text-xs text-muted-foreground">Добавить блок</Label>
      <Select
        value=""
        onValueChange={(key) => {
          if (key) onAdd(() => createBlock(key as ContentBlock["type"] | QuestionInteraction["type"]));
        }}
      >
        <SelectTrigger className="h-8">
          <SelectValue placeholder="Выберите тип…" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Контент</SelectLabel>
            {(Object.keys(CONTENT_BLOCK_LABELS) as ContentBlock["type"][]).map((t) => (
              <SelectItem key={t} value={t}>
                {CONTENT_BLOCK_LABELS[t]}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Вопрос</SelectLabel>
            {(Object.keys(INTERACTION_LABELS) as QuestionInteraction["type"][]).map((t) => (
              <SelectItem key={t} value={t}>
                {INTERACTION_LABELS[t]}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Панель 2: редактирование выбранного блока ──────────────────────────────

function BlockEditorPanel({
  block,
  onChange,
}: {
  block: MaterialBlock | null;
  onChange: (blockId: string, updater: (b: MaterialBlock) => MaterialBlock) => void;
}) {
  if (!block) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        Выберите блок слева, чтобы его редактировать
      </div>
    );
  }

  function set<B extends MaterialBlock>(patch: Partial<B>) {
    onChange(block!.id, (b) => ({ ...b, ...patch }) as MaterialBlock);
  }

  return (
    <div className="self-start rounded-lg border border-border bg-card p-4">
      <h2 className="ds-label mb-3">{blockLabel(block)}</h2>
      {block.type === "question" ? (
        <QuestionBlockFields block={block} onChange={(patch) => set(patch)} />
      ) : (
        <ContentBlockFields block={block} onChange={(patch) => set(patch)} />
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-muted-foreground">{children}</span>;
}

function TextAreaField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function ContentBlockFields({
  block,
  onChange,
}: {
  block: ContentBlock;
  onChange: (patch: Partial<ContentBlock>) => void;
}) {
  switch (block.type) {
    case "rich_text":
      return (
        <label className="flex flex-col gap-1.5">
          <FieldLabel>Текст</FieldLabel>
          <RichTextEditor html={block.html} onChange={(html) => onChange({ html })} />
        </label>
      );
    case "callout":
      return (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <FieldLabel>Вид врезки</FieldLabel>
            <Select
              value={block.variant}
              onValueChange={(v) => onChange({ variant: v as typeof block.variant })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="note">Заметка</SelectItem>
                <SelectItem value="warning">Внимание</SelectItem>
                <SelectItem value="example">Пример</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <FieldLabel>Текст</FieldLabel>
            <RichTextEditor html={block.html} onChange={(html) => onChange({ html })} />
          </label>
        </div>
      );
    case "image":
      return (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <FieldLabel>Изображение</FieldLabel>
            <MediaAssetPicker
              kind="image"
              assetId={block.assetId}
              onChange={(assetId) => onChange({ assetId })}
            />
          </label>
          <TextField
            label="Подпись"
            value={block.caption ?? ""}
            onChange={(caption) => onChange({ caption })}
          />
        </div>
      );
    case "video":
      return (
        <div className="flex flex-col gap-3">
          <TextField
            label="id файла в медиатеке"
            value={block.assetId}
            onChange={(assetId) => onChange({ assetId })}
          />
          <p className="text-[11px] text-muted-foreground">
            Видео в медиатеке — отдельная задача (транскодирование/превью), вне Э9.7
          </p>
        </div>
      );
    case "audio":
      return (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <FieldLabel>Аудио</FieldLabel>
            <MediaAssetPicker
              kind="audio"
              assetId={block.assetId}
              onChange={(assetId) => onChange({ assetId })}
            />
          </label>
          <TextAreaField
            label="Транскрипт"
            value={block.transcript ?? ""}
            onChange={(transcript) => onChange({ transcript })}
          />
        </div>
      );
    case "formula":
      return (
        <label className="flex flex-col gap-1.5">
          <FieldLabel>Формула</FieldLabel>
          <FormulaEditor latex={block.latex} onChange={(latex) => onChange({ latex })} />
        </label>
      );
    case "table": {
      const rowsText = block.rows.map((r) => r.join(" | ")).join("\n");
      return (
        <TextAreaField
          label="Таблица (строка на строку, ячейки через « | »)"
          value={rowsText}
          onChange={(text) =>
            onChange({
              rows: text.split("\n").map((line) => line.split("|").map((cell) => cell.trim())),
            })
          }
        />
      );
    }
    case "embed":
      return (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <FieldLabel>Провайдер</FieldLabel>
            <Select
              value={block.provider}
              onValueChange={(v) => onChange({ provider: v as typeof block.provider })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="geogebra">GeoGebra</SelectItem>
                <SelectItem value="desmos">Desmos</SelectItem>
                <SelectItem value="jsxgraph">JSXGraph</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <p className="text-[11px] text-muted-foreground">Настройка встраивания — появится отдельно</p>
        </div>
      );
    case "page_break":
      return <p className="text-xs text-muted-foreground">Разрыв страницы — настраивать нечего</p>;
  }
}

function QuestionBlockFields({
  block,
  onChange,
}: {
  block: QuestionBlock;
  onChange: (patch: Partial<QuestionBlock>) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <FieldLabel>Формулировка вопроса</FieldLabel>
        <RichTextEditor html={block.prompt.html} onChange={(html) => onChange({ prompt: { html } })} />
      </label>
      <label className="flex w-24 flex-col gap-1.5">
        <FieldLabel>Баллы</FieldLabel>
        <Input
          type="number"
          min={0}
          value={block.points}
          onChange={(e) => onChange({ points: Number(e.target.value) || 0 })}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <FieldLabel>Подсказка (необязательно)</FieldLabel>
        <RichTextEditor
          html={block.hint?.html ?? ""}
          onChange={(html) => onChange({ hint: html ? { html } : undefined })}
        />
      </label>
      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">
          Тип: {INTERACTION_LABELS[block.interaction.type]}
        </p>
        <InteractionEditor
          interaction={block.interaction}
          onChange={(interaction) => onChange({ interaction })}
        />
      </div>
    </div>
  );
}

// ─── Панель 3: живое превью глазами ученика ─────────────────────────────────

function LivePreviewPanel({ material }: { material: Material }) {
  const [responses, setResponses] = useState<Record<string, QuestionResponse>>({});
  const publicMaterial = stripMaterialAnswerKeys(material, "editor-preview");

  return (
    <div className="self-start overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
        Превью глазами ученика
      </div>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto p-4">
        <h3 className="text-base font-bold">{material.title}</h3>
        {publicMaterial.blocks.map((block) =>
          block.type === "question" ? (
            <QuestionPlayer
              key={block.id}
              block={block}
              value={responses[block.id]}
              onChange={(r) => setResponses((prev) => ({ ...prev, [block.id]: r }))}
            />
          ) : (
            <ContentBlockView key={block.id} block={block} />
          ),
        )}
        {publicMaterial.blocks.length === 0 && (
          <p className="text-sm text-muted-foreground">Материал пуст</p>
        )}
      </div>
    </div>
  );
}
