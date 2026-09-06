import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  CircleHelp,
  History,
  Settings2,
} from "lucide-react";
import type {
  Material,
  MaterialSettings,
  MaterialStatus,
  MaterialValidationIssue,
  MaterialVersionSummary,
  QuestionResponse,
  ShowFeedback,
} from "@school/shared";
import { stripMaterialAnswerKeys } from "@school/shared";

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
import { Switch } from "@/shared/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { toast } from "@/shared/ui/sonner";
import { ContentBlockView } from "./MaterialPlayer.js";
import { QuestionPlayer } from "./QuestionPlayer.js";
import { isPlaceholderMeta } from "./material-templates.js";
import { MaterialDocEditor } from "./editor/MaterialDocEditor.js";
import {
  getMaterial,
  getMaterialVersions,
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

  function patchMaterial(patch: Partial<Material>) {
    setMaterial((prev) => (prev ? { ...prev, ...patch } : prev));
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

  const readOnly = !canEdit;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-[900px] flex-col">
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
        <div className="mx-auto w-full max-w-[760px] pb-24">
          <SheetMeta material={material} onChange={patchMaterial} />
          <MaterialDocEditor key={id} material={material} onChange={setMaterial} />
        </div>
      )}
    </div>
  );
}

// ─── Render-единицы: блок или группа блоков из конструкции ─────────────────

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
          <Switch
            checked={settings.shuffleBlocks}
            onCheckedChange={(checked) => onChange({ shuffleBlocks: checked })}
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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-muted-foreground">{children}</span>;
}

