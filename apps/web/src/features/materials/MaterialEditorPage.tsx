import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
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
  AlertTriangle,
  AlignLeft,
  AppWindow,
  ArrowLeftRight,
  ArrowUpDown,
  AudioLines,
  Baseline,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CircleDot,
  CircleHelp,
  FileUp,
  GripVertical,
  Hash,
  History,
  Image as ImageIcon,
  LayoutTemplate,
  ListChecks,
  Plus,
  Quote,
  Search,
  SeparatorHorizontal,
  Settings2,
  Sigma,
  SquareChevronDown,
  Table as TableIcon,
  TextCursorInput,
  ToggleLeft,
  Trash2,
  Type,
  Ungroup,
  Video,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  ContentBlock,
  Material,
  MaterialBlock,
  MaterialBlockGroup,
  MaterialSettings,
  MaterialStatus,
  MaterialValidationIssue,
  MaterialVersionSummary,
  QuestionBlock,
  QuestionInteraction,
  QuestionResponse,
  ShowFeedback,
} from "@school/shared";
import { IMPORT_MAX_QUESTIONS, stripMaterialAnswerKeys } from "@school/shared";

import { cn } from "@/lib/utils";
import { useAuthStore } from "@/shared/auth-store";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
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
  MATERIAL_CONSTRUCTS,
  type MaterialConstruct,
  instantiateConstruct,
  isPlaceholderMeta,
} from "./material-templates.js";
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

const CONTENT_BLOCK_ICONS: Record<ContentBlock["type"], LucideIcon> = {
  rich_text: Type,
  image: ImageIcon,
  video: Video,
  audio: AudioLines,
  formula: Sigma,
  table: TableIcon,
  callout: Quote,
  embed: AppWindow,
  page_break: SeparatorHorizontal,
};

const INTERACTION_ICONS: Record<QuestionInteraction["type"], LucideIcon> = {
  single_choice: CircleDot,
  multiple_choice: ListChecks,
  true_false: ToggleLeft,
  text_input: TextCursorInput,
  numeric_input: Hash,
  open_answer: AlignLeft,
  cloze_dropdown: SquareChevronDown,
  cloze_text: Baseline,
  matching: ArrowLeftRight,
  ordering: ArrowUpDown,
};

type EditorMode = "edit" | "preview";

/**
 * Редактор материала (Э13, «лист» в духе Notion/Yonote). Одна колонка,
 * блоки редактируются на месте, вставка через «+»/«/», готовые конструкции
 * — карточками. Переключатель «Редактор / Просмотр» показывает материал
 * глазами ученика (`stripMaterialAnswerKeys` — ключи ответов не утекают).
 * Учитель (ревизия Э12.7) открывает материал только на просмотр.
 */
export function MaterialEditorPage() {
  const { id } = useParams<{ id: string }>();
  const currentUser = useAuthStore((s) => s.user);
  const canEdit = currentUser?.role === "admin" || currentUser?.role === "methodist";

  const [material, setMaterial] = useState<Material | null>(null);
  const [status, setStatus] = useState<MaterialStatus | null>(null);
  const [isCurrent, setIsCurrent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>(canEdit ? "edit" : "preview");
  const [validationIssues, setValidationIssues] = useState<MaterialValidationIssue[] | null>(null);
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const justLoaded = useRef(false);

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
        setIsCurrent(detail.isCurrent);
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

  // Прокрутка к блоку, на который кликнули в «Проверке» или который только
  // что вставили.
  useEffect(() => {
    if (!focusBlockId) return;
    const el = document.getElementById(`block-${focusBlockId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFocusBlockId(null), 1600);
    return () => clearTimeout(t);
  }, [focusBlockId]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="mb-2 text-sm font-medium text-destructive">{error}</p>
        <Link to="/materials/edit" className="text-sm text-muted-foreground hover:underline">
          ← В редактор
        </Link>
      </div>
    );
  }
  if (!material) return <CenteredSpinner label="Загрузка материала…" />;

  const units = buildUnits(material);

  // ─── Мутации ───────────────────────────────────────────────────────────
  function patchMaterial(patch: Partial<Material>) {
    setMaterial((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function updateBlock(blockId: string, updater: (block: MaterialBlock) => MaterialBlock) {
    setMaterial((prev) =>
      prev ? { ...prev, blocks: prev.blocks.map((b) => (b.id === blockId ? updater(b) : b)) } : prev,
    );
  }

  function updateSettings(patch: Partial<MaterialSettings>) {
    setMaterial((prev) => (prev ? { ...prev, settings: { ...prev.settings, ...patch } } : prev));
  }

  async function saveMeta(patch: {
    title: string;
    subject: string;
    grades: number[];
    topic?: string;
  }) {
    if (!material) return;
    const next: Material = { ...material, ...patch };
    setMaterial(next);
    autosave.queue(next);
    await autosave.flush();
  }

  function insertAt(
    newBlocks: MaterialBlock[],
    group: MaterialBlockGroup | null,
    afterUnitId: string | null,
  ) {
    if (newBlocks.length === 0) return;
    setMaterial((prev) => {
      if (!prev) return prev;
      const blocks = [...prev.blocks];
      let insertIndex = blocks.length;
      if (afterUnitId) {
        const unit = buildUnits(prev).find((u) => unitId(u) === afterUnitId);
        const lastId =
          unit?.kind === "group"
            ? unit.blocks[unit.blocks.length - 1]?.id
            : unit?.kind === "block"
              ? unit.block.id
              : undefined;
        const idx = lastId ? blocks.findIndex((b) => b.id === lastId) : -1;
        if (idx >= 0) insertIndex = idx + 1;
      }
      blocks.splice(insertIndex, 0, ...newBlocks);
      return { ...prev, blocks, groups: group ? [...prev.groups, group] : prev.groups };
    });
    setFocusBlockId(newBlocks[0]!.id);
  }

  function removeBlock(blockId: string) {
    setMaterial((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        blocks: prev.blocks.filter((b) => b.id !== blockId),
        groups: prev.groups
          .map((g) => ({ ...g, blockIds: g.blockIds.filter((bid) => bid !== blockId) }))
          .filter((g) => g.blockIds.length >= 2),
      };
    });
  }

  function removeGroup(groupId: string) {
    setMaterial((prev) => {
      if (!prev) return prev;
      const group = prev.groups.find((g) => g.id === groupId);
      if (!group) return prev;
      const dead = new Set(group.blockIds);
      return {
        ...prev,
        blocks: prev.blocks.filter((b) => !dead.has(b.id)),
        groups: prev.groups.filter((g) => g.id !== groupId),
      };
    });
  }

  function ungroup(groupId: string) {
    setMaterial((prev) =>
      prev ? { ...prev, groups: prev.groups.filter((g) => g.id !== groupId) } : prev,
    );
  }

  function reorderUnits(activeId: string, overId: string) {
    setMaterial((prev) => {
      if (!prev) return prev;
      const list = buildUnits(prev);
      const from = list.findIndex((u) => unitId(u) === activeId);
      const to = list.findIndex((u) => unitId(u) === overId);
      if (from === -1 || to === -1 || from === to) return prev;
      const reordered = arrayMove(list, from, to);
      const blocks = reordered.flatMap((u) => (u.kind === "block" ? [u.block] : u.blocks));
      return { ...prev, blocks };
    });
  }

  function moveBlockWithinGroup(groupId: string, blockId: string, direction: -1 | 1) {
    setMaterial((prev) => {
      if (!prev) return prev;
      const group = prev.groups.find((g) => g.id === groupId);
      if (!group) return prev;
      const orderedIds = prev.blocks.filter((b) => group.blockIds.includes(b.id)).map((b) => b.id);
      const pos = orderedIds.indexOf(blockId);
      const target = pos + direction;
      if (pos === -1 || target < 0 || target >= orderedIds.length) return prev;
      const swapWith = orderedIds[target]!;
      const blocks = [...prev.blocks];
      const i = blocks.findIndex((b) => b.id === blockId);
      const j = blocks.findIndex((b) => b.id === swapWith);
      [blocks[i], blocks[j]] = [blocks[j]!, blocks[i]!];
      return { ...prev, blocks };
    });
  }

  const readOnly = !canEdit;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-[960px] flex-col">
      <EditorTopBar
        material={material}
        status={status}
        isCurrent={isCurrent}
        canEdit={canEdit}
        role={currentUser?.role ?? null}
        mode={mode}
        onModeChange={setMode}
        autosaveStatus={autosave.status}
        materialId={id ?? null}
        validationIssues={validationIssues}
        onValidate={runValidation}
        onFlushPending={() => autosave.flush()}
        onStatusChange={setStatus}
        onPublished={() => setIsCurrent(true)}
        onSettingsChange={updateSettings}
        onSaveMeta={saveMeta}
        onSelectBlock={(blockId) => {
          setMode("edit");
          setFocusBlockId(blockId);
        }}
      />

      {mode === "preview" ? (
        <PreviewSheet material={material} readOnly={readOnly} />
      ) : (
        <EditorCanvas
          material={material}
          units={units}
          issues={validationIssues ?? []}
          focusBlockId={focusBlockId}
          onMetaChange={patchMaterial}
          onUpdateBlock={updateBlock}
          onInsert={insertAt}
          onRemoveBlock={removeBlock}
          onRemoveGroup={removeGroup}
          onUngroup={ungroup}
          onReorder={reorderUnits}
          onMoveWithinGroup={moveBlockWithinGroup}
        />
      )}
    </div>
  );
}

// ─── Render-единицы: блок или группа блоков из конструкции ─────────────────

type RenderUnit =
  | { kind: "block"; block: MaterialBlock }
  | { kind: "group"; group: MaterialBlockGroup; blocks: MaterialBlock[] };

function unitId(unit: RenderUnit): string {
  return unit.kind === "block" ? unit.block.id : unit.group.id;
}

function buildUnits(material: Material): RenderUnit[] {
  const groupByBlockId = new Map<string, MaterialBlockGroup>();
  for (const g of material.groups) for (const bid of g.blockIds) groupByBlockId.set(bid, g);
  const emitted = new Set<string>();
  const units: RenderUnit[] = [];
  for (const block of material.blocks) {
    const g = groupByBlockId.get(block.id);
    if (!g) {
      units.push({ kind: "block", block });
      continue;
    }
    if (emitted.has(g.id)) continue;
    emitted.add(g.id);
    const blocks = material.blocks.filter((b) => g.blockIds.includes(b.id));
    if (blocks.length >= 2) units.push({ kind: "group", group: g, blocks });
    else for (const b of blocks) units.push({ kind: "block", block: b });
  }
  return units;
}

// ─── Верхняя панель ──────────────────────────────────────────────────────

function EditorTopBar({
  material,
  status,
  isCurrent,
  canEdit,
  role,
  mode,
  onModeChange,
  autosaveStatus,
  materialId,
  validationIssues,
  onValidate,
  onFlushPending,
  onStatusChange,
  onPublished,
  onSettingsChange,
  onSaveMeta,
  onSelectBlock,
}: {
  material: Material;
  status: MaterialStatus | null;
  isCurrent: boolean;
  canEdit: boolean;
  role: string | null;
  mode: EditorMode;
  onModeChange: (m: EditorMode) => void;
  autosaveStatus: AutosaveStatus;
  materialId: string | null;
  validationIssues: MaterialValidationIssue[] | null;
  onValidate: () => Promise<MaterialValidationIssue[]>;
  onFlushPending: () => Promise<void> | void;
  onStatusChange: (s: MaterialStatus) => void;
  onPublished: () => void;
  onSettingsChange: (patch: Partial<MaterialSettings>) => void;
  onSaveMeta: (patch: {
    title: string;
    subject: string;
    grades: number[];
    topic?: string;
  }) => Promise<void>;
  onSelectBlock: (blockId: string) => void;
}) {
  const metaReady = !isPlaceholderMeta(material);
  return (
    <div className="sticky top-header z-20 -mx-4 mb-4 border-b border-border bg-background/90 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
      <Link
        to="/materials/edit"
        className="mb-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" aria-hidden /> Все материалы
      </Link>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{material.title}</span>
          {status ? (
            <Badge variant={STATUS_META[status].variant} className="shrink-0">
              {STATUS_META[status].label}
            </Badge>
          ) : null}
          {canEdit ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {autosaveLabel(autosaveStatus)}
            </span>
          ) : (
            <span className="shrink-0 text-xs font-medium text-warning">только просмотр</span>
          )}
        </div>

        <Tabs value={mode} onValueChange={(v) => onModeChange(v as EditorMode)}>
          <TabsList>
            {canEdit ? <TabsTrigger value="edit">Редактор</TabsTrigger> : null}
            <TabsTrigger value="preview">Просмотр</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-1.5">
          {canEdit && materialId ? <VersionHistory materialId={materialId} /> : null}
          {canEdit ? (
            <ValidationButton
              issues={validationIssues}
              onRefresh={onValidate}
              onSelectBlock={onSelectBlock}
            />
          ) : null}
          {canEdit ? (
            <SettingsMenu settings={material.settings} onChange={onSettingsChange} />
          ) : null}
          {canEdit ? (
            <SaveDialog material={material} metaReady={metaReady} onSave={onSaveMeta} />
          ) : null}
          {materialId && status ? (
            <StatusActions
              materialId={materialId}
              status={status}
              isCurrent={isCurrent}
              canEdit={canEdit}
              role={role}
              metaReady={metaReady}
              onFlushPending={onFlushPending}
              onStatusChange={onStatusChange}
              onPublished={onPublished}
              onValidate={onValidate}
            />
          ) : null}
        </div>
      </div>
    </div>
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

function parseGrades(text: string): number[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
}

/**
 * Явное «Сохранить» (Э13). Автосохранение идёт постоянно, но название и
 * класс материала методист задаёт здесь — по требованию, а не формой до
 * создания. Пока не заполнено, отправка на ревью/публикация заблокированы.
 */
function SaveDialog({
  material,
  metaReady,
  onSave,
}: {
  material: Material;
  metaReady: boolean;
  onSave: (patch: {
    title: string;
    subject: string;
    grades: number[];
    topic?: string;
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [gradesText, setGradesText] = useState("");
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function sync() {
    setTitle(metaReady ? material.title : "");
    setSubject(metaReady ? material.subject : "");
    setGradesText(metaReady ? material.grades.join(", ") : "");
    setTopic(material.topic ?? "");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const grades = parseGrades(gradesText);
    if (!title.trim() || !subject.trim() || grades.length === 0) {
      setError("Укажите название, предмет и хотя бы один класс (числом)");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        subject: subject.trim(),
        grades,
        topic: topic.trim() || undefined,
      });
      toast.success("Сохранено");
      setOpen(false);
    } catch {
      setError("Не удалось сохранить — попробуйте ещё раз");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) sync();
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={metaReady ? "outline" : "default"}>
          Сохранить
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Сохранить материал</DialogTitle>
          <DialogDescription>Укажите название и класс — по ним материал найдут в библиотеке.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <FieldLabel>Название</FieldLabel>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Квадратные уравнения"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <FieldLabel>Предмет</FieldLabel>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="математика"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <FieldLabel>Классы</FieldLabel>
              <Input
                value={gradesText}
                onChange={(e) => setGradesText(e.target.value)}
                placeholder="8 или 8, 9"
                inputMode="numeric"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <FieldLabel>Тема (необязательно)</FieldLabel>
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} />
          </label>
          {error ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" size="sm" loading={saving}>
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Холст редактора ─────────────────────────────────────────────────────

function EditorCanvas({
  material,
  units,
  issues,
  focusBlockId,
  onMetaChange,
  onUpdateBlock,
  onInsert,
  onRemoveBlock,
  onRemoveGroup,
  onUngroup,
  onReorder,
  onMoveWithinGroup,
}: {
  material: Material;
  units: RenderUnit[];
  issues: MaterialValidationIssue[];
  focusBlockId: string | null;
  onMetaChange: (patch: Partial<Material>) => void;
  onUpdateBlock: (id: string, updater: (b: MaterialBlock) => MaterialBlock) => void;
  onInsert: (
    blocks: MaterialBlock[],
    group: MaterialBlockGroup | null,
    afterUnitId: string | null,
  ) => void;
  onRemoveBlock: (id: string) => void;
  onRemoveGroup: (groupId: string) => void;
  onUngroup: (groupId: string) => void;
  onReorder: (activeId: string, overId: string) => void;
  onMoveWithinGroup: (groupId: string, blockId: string, direction: -1 | 1) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = units.map(unitId);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
  }

  return (
    <div className="mx-auto w-full max-w-[720px] pb-24">
      <SheetMeta material={material} onChange={onMetaChange} />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col">
            {units.map((unit) => (
              <SortableUnit
                key={unitId(unit)}
                unit={unit}
                issues={issues}
                focusBlockId={focusBlockId}
                onInsertAfter={(blocks, group) => onInsert(blocks, group, unitId(unit))}
                onUpdateBlock={onUpdateBlock}
                onRemoveBlock={onRemoveBlock}
                onRemoveGroup={onRemoveGroup}
                onUngroup={onUngroup}
                onMoveWithinGroup={onMoveWithinGroup}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <TrailingInsert
        empty={units.length === 0}
        onInsert={(blocks, group) => onInsert(blocks, group, null)}
      />
    </div>
  );
}

function SheetMeta({
  material,
  onChange,
}: {
  material: Material;
  onChange: (patch: Partial<Material>) => void;
}) {
  const [gradesText, setGradesText] = useState(material.grades.join(", "));

  function commitGrades() {
    const grades = [
      ...new Set(
        gradesText
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
    if (grades.length > 0) onChange({ grades });
    else setGradesText(material.grades.join(", "));
  }

  return (
    <div className="mb-4 border-b border-border pb-4">
      <input
        value={material.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="Название материала"
        className="w-full border-0 bg-transparent p-0 text-2xl font-heavy tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <MetaChip label="Предмет" value={material.subject || "—"}>
          <label className="flex flex-col gap-1.5">
            <FieldLabel>Предмет</FieldLabel>
            <Input
              value={material.subject}
              onChange={(e) => onChange({ subject: e.target.value })}
              placeholder="математика"
            />
          </label>
        </MetaChip>
        <MetaChip label="Классы" value={material.grades.join(", ") || "—"}>
          <label className="flex flex-col gap-1.5">
            <FieldLabel>Классы (через запятую)</FieldLabel>
            <Input
              value={gradesText}
              onChange={(e) => setGradesText(e.target.value)}
              onBlur={commitGrades}
              placeholder="8, 9"
              inputMode="numeric"
            />
          </label>
        </MetaChip>
        <MetaChip label="Тема" value={material.topic || "без темы"}>
          <label className="flex flex-col gap-1.5">
            <FieldLabel>Тема</FieldLabel>
            <Input
              value={material.topic ?? ""}
              onChange={(e) => onChange({ topic: e.target.value.trim() || undefined })}
              placeholder="Квадратные уравнения"
            />
          </label>
        </MetaChip>
      </div>
    </div>
  );
}

function MetaChip({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary"
        >
          <span className="font-medium text-text-3">{label}:</span>
          <span className="max-w-[12rem] truncate text-foreground">{value}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        {children}
      </PopoverContent>
    </Popover>
  );
}

// ─── Сортируемая единица (блок / группа) ─────────────────────────────────

function SortableUnit({
  unit,
  issues,
  focusBlockId,
  onInsertAfter,
  onUpdateBlock,
  onRemoveBlock,
  onRemoveGroup,
  onUngroup,
  onMoveWithinGroup,
}: {
  unit: RenderUnit;
  issues: MaterialValidationIssue[];
  focusBlockId: string | null;
  onInsertAfter: (blocks: MaterialBlock[], group: MaterialBlockGroup | null) => void;
  onUpdateBlock: (id: string, updater: (b: MaterialBlock) => MaterialBlock) => void;
  onRemoveBlock: (id: string) => void;
  onRemoveGroup: (groupId: string) => void;
  onUngroup: (groupId: string) => void;
  onMoveWithinGroup: (groupId: string, blockId: string, direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: unitId(unit),
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group/unit relative py-1.5 pl-9", isDragging && "opacity-50")}
    >
      <div className="absolute left-0 top-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/unit:opacity-100 group-focus-within/unit:opacity-100">
        <InsertMenu onInsert={onInsertAfter}>
          <button
            type="button"
            aria-label="Вставить блок"
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </InsertMenu>
        <button
          type="button"
          aria-label="Перетащить"
          className="cursor-grab rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      </div>

      {unit.kind === "group" ? (
        <GroupFrame
          group={unit.group}
          blocks={unit.blocks}
          issues={issues}
          focusBlockId={focusBlockId}
          onUpdateBlock={onUpdateBlock}
          onRemoveBlock={onRemoveBlock}
          onRemoveGroup={() => onRemoveGroup(unit.group.id)}
          onUngroup={() => onUngroup(unit.group.id)}
          onMove={(blockId, dir) => onMoveWithinGroup(unit.group.id, blockId, dir)}
        />
      ) : (
        <BlockCard
          block={unit.block}
          issues={issues}
          focus={focusBlockId === unit.block.id}
          onChange={(updater) => onUpdateBlock(unit.block.id, updater)}
          onRemove={() => onRemoveBlock(unit.block.id)}
        />
      )}
    </div>
  );
}

function GroupFrame({
  group,
  blocks,
  issues,
  focusBlockId,
  onUpdateBlock,
  onRemoveBlock,
  onRemoveGroup,
  onUngroup,
  onMove,
}: {
  group: MaterialBlockGroup;
  blocks: MaterialBlock[];
  issues: MaterialValidationIssue[];
  focusBlockId: string | null;
  onUpdateBlock: (id: string, updater: (b: MaterialBlock) => MaterialBlock) => void;
  onRemoveBlock: (id: string) => void;
  onRemoveGroup: () => void;
  onUngroup: () => void;
  onMove: (blockId: string, direction: -1 | 1) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rounded-xl border border-primary-muted bg-primary-light/40">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold text-primary"
        >
          <ChevronDown
            className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")}
            aria-hidden
          />
          <LayoutTemplate className="size-3.5" aria-hidden />
          Шаблон · {group.label}
        </button>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onUngroup}
            aria-label="Разгруппировать"
            title="Разгруппировать — оставить блоки, убрать рамку"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Ungroup className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemoveGroup}
            aria-label="Удалить конструкцию"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
      {!collapsed ? (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {blocks.map((block, i) => (
            <div key={block.id} className="flex items-start gap-1.5">
              <div className="flex flex-col pt-1">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => onMove(block.id, -1)}
                  aria-label="Выше"
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-25"
                >
                  <ChevronUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  disabled={i === blocks.length - 1}
                  onClick={() => onMove(block.id, 1)}
                  aria-label="Ниже"
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-25"
                >
                  <ChevronDown className="size-3.5" />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <BlockCard
                  block={block}
                  issues={issues}
                  focus={focusBlockId === block.id}
                  onChange={(updater) => onUpdateBlock(block.id, updater)}
                  onRemove={() => onRemoveBlock(block.id)}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-3 pb-2 text-xs text-muted-foreground">
          {blocks.length} {plural(blocks.length, "блок", "блока", "блоков")} свёрнуто
        </div>
      )}
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

// ─── Карточка блока ─────────────────────────────────────────────────────

function blockLabel(block: MaterialBlock): string {
  return block.type === "question"
    ? `Вопрос · ${INTERACTION_LABELS[block.interaction.type]}`
    : CONTENT_BLOCK_LABELS[block.type];
}

function BlockCard({
  block,
  issues,
  focus,
  onChange,
  onRemove,
}: {
  block: MaterialBlock;
  issues: MaterialValidationIssue[];
  focus: boolean;
  onChange: (updater: (b: MaterialBlock) => MaterialBlock) => void;
  onRemove: () => void;
}) {
  const blockIssues = issues.filter((i) => i.blockId === block.id);
  const set = <B extends MaterialBlock>(patch: Partial<B>) =>
    onChange((b) => ({ ...b, ...patch }) as MaterialBlock);

  const bare = block.type === "rich_text";
  const Icon =
    block.type === "question"
      ? INTERACTION_ICONS[block.interaction.type]
      : CONTENT_BLOCK_ICONS[block.type];

  return (
    <div
      id={`block-${block.id}`}
      className={cn(
        "group/card relative scroll-mt-28 rounded-xl transition-colors",
        !bare && "border border-border bg-card",
        blockIssues.length > 0 && "border-warning/70",
        focus && "ring-2 ring-primary/40",
      )}
    >
      {!bare ? (
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Icon className="size-3.5" aria-hidden />
            {blockLabel(block)}
          </span>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Удалить блок"
            className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/card:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Удалить блок"
          className="absolute -right-1 top-0 z-10 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/card:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}

      <div className={cn(bare ? "" : "p-3")}>
        {block.type === "question" ? (
          <QuestionBlockFields block={block} onChange={(patch) => set(patch)} />
        ) : (
          <ContentBlockFields block={block} onChange={(patch) => set(patch)} />
        )}
      </div>

      {blockIssues.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 pb-2 text-[11px] text-warning">
          {blockIssues.map((i, k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <AlertTriangle className="size-3" aria-hidden />
              {i.message}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Меню вставки блока ─────────────────────────────────────────────────

function InsertMenu({
  onInsert,
  children,
}: {
  onInsert: (blocks: MaterialBlock[], group: MaterialBlockGroup | null) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [constructsOpen, setConstructsOpen] = useState(false);

  const contentTypes = Object.keys(CONTENT_BLOCK_LABELS) as ContentBlock["type"][];
  const questionTypes = Object.keys(INTERACTION_LABELS) as QuestionInteraction["type"][];
  const q = query.trim().toLowerCase();
  const match = (label: string) => !q || label.toLowerCase().includes(q);

  function addAtomic(key: ContentBlock["type"] | QuestionInteraction["type"]) {
    onInsert([createBlock(key)], null);
    close();
  }
  function close() {
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <div className="border-b border-border p-2">
            <div className="flex items-center gap-2 rounded-md border border-border px-2">
              <Search className="size-3.5 text-muted-foreground" aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Тип блока…"
                className="h-8 w-full bg-transparent text-sm outline-none"
              />
            </div>
          </div>
          <div className="max-h-[50vh] overflow-y-auto p-1.5">
            <button
              type="button"
              onClick={() => {
                setConstructsOpen(true);
                close();
              }}
              className="flex w-full items-center gap-2 rounded-md border border-primary-muted bg-primary-light/50 px-2 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-primary-light"
            >
              <LayoutTemplate className="size-4 shrink-0" aria-hidden />
              Конструкции — готовые каркасы…
            </button>

            <MenuGroup label="Контент">
              {contentTypes.filter((t) => match(CONTENT_BLOCK_LABELS[t])).map((t) => (
                <MenuRow
                  key={t}
                  icon={CONTENT_BLOCK_ICONS[t]}
                  label={CONTENT_BLOCK_LABELS[t]}
                  onClick={() => addAtomic(t)}
                />
              ))}
            </MenuGroup>
            <MenuGroup label="Вопрос">
              {questionTypes.filter((t) => match(INTERACTION_LABELS[t])).map((t) => (
                <MenuRow
                  key={t}
                  icon={INTERACTION_ICONS[t]}
                  label={INTERACTION_LABELS[t]}
                  onClick={() => addAtomic(t)}
                />
              ))}
            </MenuGroup>

            <div className="border-t border-border pt-1">
              <ImportRow
                onImported={(blocks) => {
                  onInsert(blocks, null);
                  close();
                }}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <ConstructPickerDialog
        open={constructsOpen}
        onOpenChange={setConstructsOpen}
        onPick={(construct) => {
          const { blocks, group } = instantiateConstruct(construct);
          onInsert(blocks, group);
          setConstructsOpen(false);
        }}
      />
    </>
  );
}

function MenuGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(items) && items.length === 0) return null;
  return (
    <div className="mt-1">
      <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        {label}
      </p>
      {items}
    </div>
  );
}

function MenuRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-secondary"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      {label}
    </button>
  );
}

function ImportRow({ onImported }: { onImported: (blocks: MaterialBlock[]) => void }) {
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
        setMessage("В файле не нашлось текста");
        return;
      }
      onImported(result.blocks);
      toast.success(
        `Добавлено блоков: ${result.blocks.length}${
          result.truncated ? ` (лимит ${IMPORT_MAX_QUESTIONS})` : ""
        } — проверьте вручную`,
      );
    } catch {
      setMessage("Не удалось разобрать файл (.docx / .pdf)");
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
      <FileUp className="size-4 shrink-0" aria-hidden />
      {busy ? "Распознавание…" : "Импорт из Word/PDF"}
      <input type="file" accept=".docx,.pdf" onChange={handleFile} disabled={busy} className="hidden" />
      {message ? <span className="text-[11px] text-destructive">{message}</span> : null}
    </label>
  );
}

// ─── Диалог-пикер конструкций (визуальные карточки) ──────────────────────

function ConstructPickerDialog({
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
            Готовые каркасы и блоки-заготовки. Вставятся в лист — останется заменить текст на свой.
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

function TrailingInsert({
  empty,
  onInsert,
}: {
  empty: boolean;
  onInsert: (blocks: MaterialBlock[], group: MaterialBlockGroup | null) => void;
}) {
  return (
    <div className={cn("pl-9", empty ? "mt-2" : "mt-1")}>
      <InsertMenu onInsert={onInsert}>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary",
            empty ? "py-10 justify-center" : "py-2.5",
          )}
        >
          <Plus className="size-4" aria-hidden />
          {empty ? "Пустой лист — добавьте блок или конструкцию" : "Добавить блок"}
        </button>
      </InsertMenu>
    </div>
  );
}

// ─── Просмотр глазами ученика ────────────────────────────────────────────

function PreviewSheet({ material, readOnly }: { material: Material; readOnly: boolean }) {
  const [responses, setResponses] = useState<Record<string, QuestionResponse>>({});
  const publicMaterial = stripMaterialAnswerKeys(material, "editor-preview");

  return (
    <div className="mx-auto w-full max-w-[720px] pb-24">
      <div className="mb-4 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
        {readOnly
          ? "Просмотр материала. Редактируют методист и администратор."
          : "Так материал видит ученик. Ответы можно потыкать — они не сохраняются."}
      </div>
      <h1 className="ds-page-title mb-4">{material.title}</h1>
      <div className="flex flex-col gap-3">
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
        {publicMaterial.blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Материал пуст</p>
        ) : null}
      </div>
    </div>
  );
}

// ─── Действия статуса / версии / валидация / настройки ──────────────────

function StatusActions({
  materialId,
  status,
  isCurrent,
  canEdit,
  role,
  metaReady,
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
  metaReady: boolean;
  onFlushPending: () => Promise<void> | void;
  onStatusChange: (status: MaterialStatus) => void;
  onPublished: () => void;
  onValidate: () => Promise<MaterialValidationIssue[]>;
}) {
  const [pending, setPending] = useState(false);
  const isStaff = role === "admin" || role === "methodist";

  function guardMeta(): boolean {
    if (metaReady) return true;
    toast.error("Сначала нажмите «Сохранить» — укажите название и класс");
    return false;
  }

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
            guardMeta() &&
            run(async () => onStatusChange((await submitMaterialForReview(materialId)).status))
          }
        >
          На ревью
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
          В черновик
        </Button>
      )}
      {isStaff && !isCurrent && (
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            guardMeta() &&
            run(async () => {
              const issues = await onValidate();
              if (issues.length > 0) {
                toast.error(
                  `Материал не готов к публикации — проблем: ${issues.length}. Смотрите «Проверка».`,
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

function VersionHistory({ materialId }: { materialId: string }) {
  const [items, setItems] = useState<MaterialVersionSummary[] | null>(null);

  function load() {
    if (items !== null) return;
    getMaterialVersions(materialId)
      .then((res) => setItems(res.items))
      .catch(() => setItems([]));
  }

  return (
    <Popover onOpenChange={(o) => o && load()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <History aria-hidden />
          Версии
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">История версий</p>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          {items === null && <li>Загрузка…</li>}
          {items?.length === 0 && <li>Версий пока нет</li>}
          {items?.map((v) => (
            <li key={v.versionId} className="flex items-center justify-between gap-2">
              <span>Версия {v.version}</span>
              <span>
                {new Date(v.createdAt).toLocaleDateString("ru-RU")}
                {v.isCurrent && <span className="ml-1 font-medium text-success">· опубликована</span>}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

const VALIDATION_ISSUE_LABELS: Record<MaterialValidationIssue["code"], string> = {
  material_empty: "Материал пуст",
  empty_content: "Пустой блок",
  no_correct_answer: "Нет правильного ответа",
  zero_points: "0 баллов",
  broken_asset: "Битый файл",
};

function ValidationButton({
  issues,
  onRefresh,
  onSelectBlock,
}: {
  issues: MaterialValidationIssue[] | null;
  onRefresh: () => Promise<MaterialValidationIssue[]>;
  onSelectBlock: (blockId: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      await onRefresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          {issues === null ? (
            <CircleHelp aria-hidden />
          ) : issues.length === 0 ? (
            <CheckCircle2 className="text-success" aria-hidden />
          ) : (
            <AlertTriangle className="text-warning" aria-hidden />
          )}
          Проверка
          {issues && issues.length > 0 ? <Badge variant="yellow">{issues.length}</Badge> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground">Проверка перед публикацией</p>
          <Button variant="outline" size="sm" onClick={refresh} loading={loading}>
            {loading ? "Проверка…" : "Проверить"}
          </Button>
        </div>
        {issues === null && <p className="text-xs text-muted-foreground">Материал ещё не проверялся.</p>}
        {issues?.length === 0 && (
          <p className="text-xs font-medium text-success">Проблем не найдено — можно публиковать.</p>
        )}
        {issues && issues.length > 0 && (
          <ul className="space-y-1.5 text-xs">
            {issues.map((issue, i) => (
              <li key={i}>
                {issue.blockId ? (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectBlock(issue.blockId!);
                      setOpen(false);
                    }}
                    className="text-left text-primary hover:underline"
                  >
                    <span className="font-medium">{VALIDATION_ISSUE_LABELS[issue.code]}:</span>{" "}
                    {issue.message}
                  </button>
                ) : (
                  <span>
                    <span className="font-medium">{VALIDATION_ISSUE_LABELS[issue.code]}:</span>{" "}
                    {issue.message}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

const SHOW_FEEDBACK_LABELS: Record<ShowFeedback, string> = {
  never: "Не показывать",
  immediate: "Сразу после ответа",
  after_submit: "После сдачи работы",
  after_deadline: "После дедлайна",
};

function SettingsMenu({
  settings,
  onChange,
}: {
  settings: MaterialSettings;
  onChange: (patch: Partial<MaterialSettings>) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <Settings2 aria-hidden />
          Настройки
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground">Настройки материала</p>
        <label className="flex items-center justify-between gap-2 text-sm">
          Перемешивать блоки
          <input
            type="checkbox"
            checked={settings.shuffleBlocks}
            onChange={(e) => onChange({ shuffleBlocks: e.target.checked })}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <FieldLabel>Показ обратной связи</FieldLabel>
          <Select
            value={settings.showFeedback}
            onValueChange={(v) => onChange({ showFeedback: v as ShowFeedback })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SHOW_FEEDBACK_LABELS) as ShowFeedback[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {SHOW_FEEDBACK_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <FieldLabel>Число попыток</FieldLabel>
          <Input
            type="number"
            min={1}
            value={settings.attemptsAllowed}
            onChange={(e) => onChange({ attemptsAllowed: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
      </PopoverContent>
    </Popover>
  );
}

// ─── Формы блоков (перенесены из Э9.2, презентация под лист Э13) ─────────

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
      return <RichTextEditor html={block.html} onChange={(html) => onChange({ html })} />;
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
            label="Ссылка на видео"
            value={block.assetId}
            onChange={(assetId) => onChange({ assetId })}
          />
          <p className="text-[11px] text-muted-foreground">
            Загрузка видео в медиатеку появится позже — пока укажите ссылку.
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
          <p className="text-[11px] text-muted-foreground">
            Параметры встраивания можно будет настроить после сохранения.
          </p>
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
  const [advanced, setAdvanced] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <FieldLabel>Формулировка вопроса</FieldLabel>
        <RichTextEditor html={block.prompt.html} onChange={(html) => onChange({ prompt: { html } })} />
      </label>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">
          Ответ · {INTERACTION_LABELS[block.interaction.type]}
        </p>
        <InteractionEditor
          interaction={block.interaction}
          onChange={(interaction) => onChange({ interaction })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <FieldLabel>Баллы</FieldLabel>
          <Input
            type="number"
            min={0}
            value={block.points}
            onChange={(e) => onChange({ points: Number(e.target.value) || 0 })}
            className="h-8 w-20"
          />
        </label>
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="text-xs font-medium text-primary hover:underline"
        >
          {advanced ? "Скрыть подсказку" : "Добавить подсказку"}
        </button>
      </div>

      {advanced ? (
        <label className="flex flex-col gap-1.5">
          <FieldLabel>Подсказка (необязательно)</FieldLabel>
          <RichTextEditor
            html={block.hint?.html ?? ""}
            onChange={(html) => onChange({ hint: html ? { html } : undefined })}
          />
        </label>
      ) : null}
    </div>
  );
}
