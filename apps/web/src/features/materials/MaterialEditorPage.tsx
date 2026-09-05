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
import { useAuthStore } from "../../shared/auth-store.js";

/**
 * Редактор материала (Э9.2 — каркас трёх панелей; Э9.3 — drag&drop
 * переупорядочивания блоков и автосохранение черновика; Э9.4 — Tiptap для
 * формулировок и MathLive для формул; Э9.5/9.6 — редакторы вариантов
 * ответа/ключа для всех 10 типов, `InteractionEditor` в
 * `QuestionInteractionEditors.tsx`; Э9.7 — медиатека, `MediaAssetPicker`
 * для `image`/`audio` блоков — `video` сознательно не переведён, план
 * ограничивает подзадачу картинками/аудио). `points`/`prompt`/`hint`
 * редактируются для всех 10 типов одинаково прямо здесь — это общие поля
 * `questionBlockSchema`, не часть интеракции.
 *
 * Автосохранение (Э9.3, §8 ТЗ `PUT /materials/:id`) пишет на сервер в
 * ЛЮБОМ статусе (Э9.8): пока материал никогда не публиковался — правит
 * версию на месте, если уже опубликован — форкает (или продолжает форк)
 * новую поверх, видимую школе публикацию не трогая. `canEdit` — зеркало
 * серверной проверки ВЛАДЕНИЯ (учитель пишет только в свой материал,
 * admin/methodist — в любой), без проверки статуса — она больше не
 * блокирует запись ни при каком статусе; экономит лишние запросы, сама
 * проверка прав — на сервере.
 *
 * Переходы статуса (Э9.8, §8 ТЗ) — три кнопки в заголовке, видимость
 * зависит от роли/статуса/`isCurrent` (см. `StatusActions` ниже):
 * «Отправить на ревью» (draft→review, тот, кто может редактировать),
 * «Вернуть в черновик» (review→draft, решение ревьюера — только admin/
 * methodist), «Опубликовать» (единая кнопка и для первой публикации, и
 * для повторной публикации форка — видна admin/methodist, когда
 * `!isCurrent`, т.е. есть что публиковать).
 *
 * Валидатор (Э9.9, §7.2 ТЗ «Валидация») — отдельная секция
 * (`ValidationPanel`, свёрнута по умолчанию, как `VersionHistory`) и
 * ОДИН И ТОТ ЖЕ вызов `GET /materials/:id/validate`, которым пользуется
 * кнопка «Опубликовать»: перед реальной публикацией `StatusActions`
 * сначала гоняет проверку и, если нашлись проблемы, публикацию НЕ
 * отправляет вовсе (список проблем информативнее общего текста 409,
 * который на этот случай тоже есть на сервере — `publish`, defense in
 * depth, а не единственная защита).
 *
 * Стоп-лист Э9 («НЕ показывать методисту JSON. Никогда. Ни в каком виде»)
 * — соблюдён буквально: ни один контрол в этом файле не показывает и не
 * принимает сырой JSON (в частности `embed.config` — единственное поле
 * материала типа `Record<string, unknown>` — здесь НЕредактируемо).
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
    // autosave.queue меняется только при смене id/canEdit, добавлять его в зависимости не нужно — иначе лишние срабатывания при пересоздании функции.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material]);

  if (error) {
    return (
      <div className="mx-auto mt-12 max-w-2xl px-4">
        <p className="text-sm text-red-600">{error}</p>
        <Link to="/materials" className="text-sm text-slate-500 underline">
          ← Назад в библиотеку
        </Link>
      </div>
    );
  }
  if (!material) {
    return (
      <div className="mx-auto mt-12 max-w-2xl px-4">
        <p className="text-sm text-slate-400">Загрузка…</p>
      </div>
    );
  }

  function updateBlock(blockId: string, updater: (block: MaterialBlock) => MaterialBlock) {
    setMaterial((prev) =>
      prev
        ? { ...prev, blocks: prev.blocks.map((b) => (b.id === blockId ? updater(b) : b)) }
        : prev,
    );
  }

  function addBlock(makeBlock: () => MaterialBlock) {
    const block = makeBlock();
    setMaterial((prev) => (prev ? { ...prev, blocks: [...prev.blocks, block] } : prev));
    setSelectedBlockId(block.id);
  }

  /** Массовое добавление (Э9.11, импорт из Word/PDF) — та же логика, что `addBlock`, но сразу N блоков одним обновлением состояния, не циклом из N вызовов `addBlock` (лишние промежуточные рендеры и промежуточные записи в очередь автосохранения). */
  function addBlocks(newBlocks: MaterialBlock[]) {
    if (newBlocks.length === 0) return;
    setMaterial((prev) => (prev ? { ...prev, blocks: [...prev.blocks, ...newBlocks] } : prev));
    setSelectedBlockId(newBlocks[0]!.id);
  }

  function removeBlock(blockId: string) {
    setMaterial((prev) => (prev ? { ...prev, blocks: prev.blocks.filter((b) => b.id !== blockId) } : prev));
    setSelectedBlockId((prev) => (prev === blockId ? null : prev));
  }

  function reorderBlocks(fromIndex: number, toIndex: number) {
    setMaterial((prev) => (prev ? { ...prev, blocks: arrayMove(prev.blocks, fromIndex, toIndex) } : prev));
  }

  const selectedBlock = material.blocks.find((b) => b.id === selectedBlockId) ?? null;

  return (
    <div className="mx-auto mt-4 max-w-7xl px-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to="/materials" className="text-xs text-slate-500 underline">
            ← Библиотека
          </Link>
          <h1 className="text-lg font-semibold">{material.title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <p className={`text-xs ${canEdit ? "text-slate-500" : "text-amber-600"}`}>
            {canEdit ? autosaveLabel(autosave.status) : "Материал не ваш — доступен только для просмотра"}
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
        <ValidationPanel issues={validationIssues} onRefresh={runValidation} onSelectBlock={setSelectedBlockId} />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_1fr]">
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

/**
 * Кнопки перехода статуса (Э9.8, §8 ТЗ). Видимость:
 * - «Отправить на ревью» — `status === "draft"`, тот, кто может
 *   редактировать (владелец-учитель или admin/methodist — та же `canEdit`,
 *   что и у автосохранения: право писать в материал включает право
 *   сдвинуть его дальше по своему же workflow).
 * - «Вернуть в черновик» — `status === "review"`, ТОЛЬКО admin/methodist
 *   (решение ревьюера, не самого автора).
 * - «Опубликовать» — ТОЛЬКО admin/methodist, когда `!isCurrent` (есть что
 *   публиковать — неважно, первая публикация черновика или форк поверх
 *   уже опубликованного, кнопка и запрос на сервер одни и те же).
 *
 * Перед любым переходом — `onFlushPending()` (сброс дебаунса
 * автосохранения): иначе только что напечатанное могло уйти на сервер
 * ПОСЛЕ отправки на ревью/публикации, и методист увидел бы старую версию.
 */
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
  const [actionError, setActionError] = useState<string | null>(null);
  const isStaff = role === "admin" || role === "methodist";

  async function run(action: () => Promise<void>) {
    setPending(true);
    setActionError(null);
    try {
      await onFlushPending();
      await action();
    } catch {
      setActionError("Не получилось — попробуйте ещё раз");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {actionError && <span className="text-xs text-red-600">{actionError}</span>}
      {canEdit && status === "draft" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(async () => onStatusChange((await submitMaterialForReview(materialId)).status))}
          className="rounded border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
        >
          Отправить на ревью
        </button>
      )}
      {isStaff && status === "review" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(async () => onStatusChange((await returnMaterialToDraft(materialId)).status))}
          className="rounded border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
        >
          Вернуть в черновик
        </button>
      )}
      {isStaff && !isCurrent && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              // Клиентская проверка ПЕРЕД попыткой публикации (Э9.9) — сервер
              // (`publish`) откажет тем же списком проблем через 409, но здесь
              // список приходит структурированным (можно кликнуть на конкретный
              // блок), а не одной строкой сообщения об ошибке.
              const issues = await onValidate();
              if (issues.length > 0) {
                setActionError(`Материал не готов к публикации — проблем: ${issues.length}. Смотрите вкладку «Валидация» ниже.`);
                return;
              }
              await publishMaterial(materialId);
              onStatusChange("published");
              onPublished();
            })
          }
          className="btn btn-primary btn-sm"
        >
          Опубликовать
        </button>
      )}
    </div>
  );
}

/** История версий (Э9.8, §8 ТЗ `GET /materials/:id/versions`) — свёрнута по умолчанию, грузится лениво при первом раскрытии. */
function VersionHistory({ materialId }: { materialId: string }) {
  const [items, setItems] = useState<MaterialVersionSummary[] | null>(null);

  function load() {
    if (items !== null) return;
    getMaterialVersions(materialId)
      .then((res) => setItems(res.items))
      .catch(() => setItems([]));
  }

  return (
    <details
      className="mb-3 text-xs text-slate-500"
      onToggle={(e) => {
        if (e.currentTarget.open) load();
      }}
    >
      <summary className="cursor-pointer">История версий</summary>
      <ul className="mt-1 space-y-0.5 pl-3">
        {items === null && <li>Загрузка…</li>}
        {items?.length === 0 && <li>Версий пока нет</li>}
        {items?.map((v) => (
          <li key={v.versionId}>
            Версия {v.version} — {new Date(v.createdAt).toLocaleString()}
            {v.isCurrent && <span className="ml-1 text-emerald-600">(опубликована сейчас)</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

const VALIDATION_ISSUE_LABELS: Record<MaterialValidationIssue["code"], string> = {
  material_empty: "Материал пуст",
  empty_content: "Пустой блок",
  no_correct_answer: "Нет правильного ответа",
  zero_points: "0 баллов",
  broken_asset: "Битый файл",
};

/**
 * Валидация перед публикацией (Э9.9, §7.2 ТЗ «Валидация» — отдельный
 * экран редактора) — свёрнута по умолчанию, как `VersionHistory`, но
 * содержимое не грузится автоматически при раскрытии: проверка ходит в
 * БД (битые картинки, `checkBrokenAssets`), гонять её на каждый клик по
 * `<summary>` расточительно — только явная кнопка «Проверить». Тот же
 * `issues`/`onRefresh` используются кнопкой «Опубликовать» в
 * `StatusActions` — один источник данных, не два похожих запроса.
 */
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

  return (
    <details className="mb-3 text-xs text-slate-500">
      <summary className="cursor-pointer">
        Валидация
        {issues !== null &&
          (issues.length === 0 ? (
            <span className="ml-1 text-emerald-600">(готов к публикации)</span>
          ) : (
            <span className="ml-1 text-amber-600">({issues.length})</span>
          ))}
      </summary>
      <div className="mt-1 pl-3">
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="mb-1 rounded border px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Проверка…" : "Проверить"}
        </button>
        {issues === null && <p>Ещё не проверялся</p>}
        {issues?.length === 0 && <p className="text-emerald-600">Проблем не найдено</p>}
        {issues && issues.length > 0 && (
          <ul className="space-y-0.5">
            {issues.map((issue, i) => (
              <li key={i}>
                {issue.blockId ? (
                  <button type="button" onClick={() => onSelectBlock(issue.blockId!)} className="text-left underline">
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
      </div>
    </details>
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
  return block.type === "question" ? `Вопрос: ${INTERACTION_LABELS[block.interaction.type]}` : CONTENT_BLOCK_LABELS[block.type];
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
    <div className="rounded border">
      <div className="border-b bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
        Блоки ({blocks.length})
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
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
        <p className="px-3 py-4 text-center text-xs text-slate-400">Материал пуст — добавьте первый блок</p>
      )}
      {selectedBlockId && (
        <button
          onClick={() => onRemove(selectedBlockId)}
          className="w-full border-t px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
        >
          Удалить выбранный блок
        </button>
      )}
      <AddBlockMenu onAdd={onAdd} />
      <ImportFromDocument onImported={onAddMany} />
    </div>
  );
}

/**
 * Полуавтоматический импорт из Word/PDF (Э9.11, §7 ТЗ) — «дать поправить
 * руками» в буквальном смысле: распознанные блоки появляются в списке
 * блоков, как будто их добавили по одному через «Добавить блок», методист
 * правит их дальше тем же самым редактором (Э9.2–9.6), ничего специального
 * для импортированных блоков нет — они неотличимы от созданных вручную.
 */
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
    <div className="border-t p-2">
      <label className="block cursor-pointer text-xs text-slate-500 hover:text-slate-700">
        {busy ? "Распознавание…" : "Импортировать из Word/PDF"}
        <input type="file" accept=".docx,.pdf" onChange={handleFile} disabled={busy} className="hidden" />
      </label>
      {message && <p className="mt-1 text-[11px] text-slate-500">{message}</p>}
    </div>
  );
}

/** Тот же приём, что `SortableOrderingItem` в `AdvancedInteractionPlayers.tsx` (Э8.5, `ordering`) — drag-хэндл + кнопки ▲▼ как клавиатурная гарантия §16 ТЗ, не только допущение о поведении сенсора. */
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1 ${isDragging ? "opacity-50" : ""} ${selected ? "bg-slate-100" : ""}`}
    >
      <span {...attributes} {...listeners} className="cursor-grab select-none px-1 text-slate-400" aria-hidden="true">
        ⠿
      </span>
      <button
        onClick={onSelect}
        className={`flex flex-1 flex-col items-start gap-0.5 px-1 py-2 text-left text-sm ${selected ? "" : "hover:bg-slate-50"}`}
      >
        <span className="text-xs text-slate-400">
          {index + 1}. {blockLabel(block)}
        </span>
        <span className="truncate text-sm">{blockPreviewText(block)}</span>
      </button>
      <span className="flex flex-col pr-1">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          aria-label="Переместить блок выше"
          className="rounded border px-1 text-[10px] disabled:opacity-30"
        >
          ▲
        </button>
        <button
          type="button"
          disabled={index === total - 1}
          onClick={() => onMove(1)}
          aria-label="Переместить блок ниже"
          className="rounded border px-1 text-[10px] disabled:opacity-30"
        >
          ▼
        </button>
      </span>
    </li>
  );
}

function AddBlockMenu({ onAdd }: { onAdd: (makeBlock: () => MaterialBlock) => void }) {
  return (
    <div className="border-t p-2">
      <label className="block text-xs text-slate-500">
        Добавить блок
        <select
          value=""
          onChange={(e) => {
            const key = e.target.value;
            if (key) onAdd(() => createBlock(key as ContentBlock["type"] | QuestionInteraction["type"]));
          }}
          className="mt-1 block w-full rounded border px-2 py-1 text-sm"
        >
          <option value="" disabled>
            Выберите тип…
          </option>
          <optgroup label="Контент">
            {(Object.keys(CONTENT_BLOCK_LABELS) as ContentBlock["type"][]).map((t) => (
              <option key={t} value={t}>
                {CONTENT_BLOCK_LABELS[t]}
              </option>
            ))}
          </optgroup>
          <optgroup label="Вопрос">
            {(Object.keys(INTERACTION_LABELS) as QuestionInteraction["type"][]).map((t) => (
              <option key={t} value={t}>
                {INTERACTION_LABELS[t]}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
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
      <div className="rounded border p-4 text-sm text-slate-400">Выберите блок слева, чтобы его редактировать</div>
    );
  }

  function set<B extends MaterialBlock>(patch: Partial<B>) {
    onChange(block!.id, (b) => ({ ...b, ...patch }) as MaterialBlock);
  }

  return (
    <div className="rounded border p-4">
      <h2 className="mb-3 text-sm font-medium text-slate-600">{blockLabel(block)}</h2>
      {block.type === "question" ? (
        <QuestionBlockFields block={block} onChange={(patch) => set(patch)} />
      ) : (
        <ContentBlockFields block={block} onChange={(patch) => set(patch)} />
      )}
    </div>
  );
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
    <label className="block text-xs text-slate-500">
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="mt-1 block w-full rounded border px-2 py-1 text-sm"
      />
      {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs text-slate-500">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded border px-2 py-1 text-sm"
      />
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
        <label className="block text-xs text-slate-500">
          Текст
          <div className="mt-1">
            <RichTextEditor html={block.html} onChange={(html) => onChange({ html })} />
          </div>
        </label>
      );
    case "callout":
      return (
        <div className="flex flex-col gap-3">
          <label className="block text-xs text-slate-500">
            Вид врезки
            <select
              value={block.variant}
              onChange={(e) => onChange({ variant: e.target.value as typeof block.variant })}
              className="mt-1 block w-full rounded border px-2 py-1 text-sm"
            >
              <option value="note">Заметка</option>
              <option value="warning">Внимание</option>
              <option value="example">Пример</option>
            </select>
          </label>
          <label className="block text-xs text-slate-500">
            Текст
            <div className="mt-1">
              <RichTextEditor html={block.html} onChange={(html) => onChange({ html })} />
            </div>
          </label>
        </div>
      );
    case "image":
      return (
        <div className="flex flex-col gap-3">
          <label className="block text-xs text-slate-500">
            Изображение
            <div className="mt-1">
              <MediaAssetPicker kind="image" assetId={block.assetId} onChange={(assetId) => onChange({ assetId })} />
            </div>
          </label>
          <TextField label="Подпись" value={block.caption ?? ""} onChange={(caption) => onChange({ caption })} />
        </div>
      );
    case "video":
      return (
        <div className="flex flex-col gap-3">
          <TextField label="id файла в медиатеке" value={block.assetId} onChange={(assetId) => onChange({ assetId })} />
          <p className="text-[11px] text-slate-400">
            Видео в медиатеке — отдельная задача (транскодирование/превью), вне Э9.7
          </p>
        </div>
      );
    case "audio":
      return (
        <div className="flex flex-col gap-3">
          <label className="block text-xs text-slate-500">
            Аудио
            <div className="mt-1">
              <MediaAssetPicker kind="audio" assetId={block.assetId} onChange={(assetId) => onChange({ assetId })} />
            </div>
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
        <label className="block text-xs text-slate-500">
          Формула
          <div className="mt-1">
            <FormulaEditor latex={block.latex} onChange={(latex) => onChange({ latex })} />
          </div>
        </label>
      );
    case "table": {
      const rowsText = block.rows.map((r) => r.join(" | ")).join("\n");
      return (
        <TextAreaField
          label="Таблица (строка на строку, ячейки через « | »)"
          value={rowsText}
          onChange={(text) =>
            onChange({ rows: text.split("\n").map((line) => line.split("|").map((cell) => cell.trim())) })
          }
        />
      );
    }
    case "embed":
      return (
        <div className="flex flex-col gap-3">
          <label className="block text-xs text-slate-500">
            Провайдер
            <select
              value={block.provider}
              onChange={(e) => onChange({ provider: e.target.value as typeof block.provider })}
              className="mt-1 block w-full rounded border px-2 py-1 text-sm"
            >
              <option value="geogebra">GeoGebra</option>
              <option value="desmos">Desmos</option>
              <option value="jsxgraph">JSXGraph</option>
            </select>
          </label>
          <p className="text-[11px] text-slate-400">Настройка встраивания — появится отдельно</p>
        </div>
      );
    case "page_break":
      return <p className="text-xs text-slate-400">Разрыв страницы — настраивать нечего</p>;
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
    <div className="flex flex-col gap-3">
      <label className="block text-xs text-slate-500">
        Формулировка вопроса
        <div className="mt-1">
          <RichTextEditor html={block.prompt.html} onChange={(html) => onChange({ prompt: { html } })} />
        </div>
      </label>
      <label className="block text-xs text-slate-500">
        Баллы
        <input
          type="number"
          min={0}
          value={block.points}
          onChange={(e) => onChange({ points: Number(e.target.value) || 0 })}
          className="mt-1 block w-24 rounded border px-2 py-1 text-sm"
        />
      </label>
      <label className="block text-xs text-slate-500">
        Подсказка (необязательно)
        <div className="mt-1">
          <RichTextEditor
            html={block.hint?.html ?? ""}
            onChange={(html) => onChange({ hint: html ? { html } : undefined })}
          />
        </div>
      </label>
      <div className="rounded border p-2">
        <p className="mb-2 text-xs font-medium text-slate-600">Тип: {INTERACTION_LABELS[block.interaction.type]}</p>
        <InteractionEditor interaction={block.interaction} onChange={(interaction) => onChange({ interaction })} />
      </div>
    </div>
  );
}

// ─── Панель 3: живое превью глазами ученика ─────────────────────────────────

function LivePreviewPanel({ material }: { material: Material }) {
  const [responses, setResponses] = useState<Record<string, QuestionResponse>>({});
  const publicMaterial = stripMaterialAnswerKeys(material, "editor-preview");

  return (
    <div className="rounded border">
      <div className="border-b bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">Превью глазами ученика</div>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3">
        <h3 className="text-base font-semibold">{material.title}</h3>
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
        {publicMaterial.blocks.length === 0 && <p className="text-sm text-slate-400">Материал пуст</p>}
      </div>
    </div>
  );
}
