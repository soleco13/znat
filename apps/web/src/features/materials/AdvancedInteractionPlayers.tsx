import { useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
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
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import type { QuestionResponse } from "@school/shared";

import { sanitizeHtml } from "@/shared/sanitize-html";
import { Textarea } from "@/shared/ui/textarea";

const INLINE_FIELD =
  "mx-1 rounded-md border border-border bg-card px-2 py-0.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15";

/**
 * Плеер заданий, типы 6–10 (Э8.5, продолжение `QuestionPlayer.tsx` —
 * `open_answer`, `cloze_dropdown`, `cloze_text`, `matching`, `ordering`) +
 * тип 11 `categorize` (Э13, доп. «внедряй всё»).
 * §16 ТЗ («клавиатурная навигация во всех типах заданий») здесь весомее,
 * чем в Э8.4: `matching`/`ordering` — единственные два типа из всех 10, где
 * ПЛАН.md прямо называет `dnd-kit` инструментом. Drag-and-drop сам по себе
 * не гарантирует клавиатурную доступность — библиотека даёт `KeyboardSensor`,
 * но для `ordering` (переставить элементы одного списка,
 * `@dnd-kit/sortable`) это устоявшийся, хорошо документированный сценарий,
 * а для `matching` (перенести элемент в один из НЕСКОЛЬКИХ отдельных слотов,
 * `@dnd-kit/core` без `sortable`) клавиатурная семантика курсора менее
 * очевидна из коробки. Поэтому `matching` получает DnD как основной способ
 * ПЛЮС `<select>` на каждый левый элемент — тот же результат, гарантированно
 * доступный с клавиатуры без каких-либо допущений о поведении сенсора.
 */

function splitTemplate(template: string): (string | { gapId: string })[] {
  const parts: (string | { gapId: string })[] = [];
  const regex = /\{\{(\w+)\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template))) {
    if (match.index > lastIndex) parts.push(template.slice(lastIndex, match.index));
    parts.push({ gapId: match[1]! });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < template.length) parts.push(template.slice(lastIndex));
  return parts;
}

export function OpenAnswerPlayer({
  questionId,
  maxLength,
  value,
  onChange,
  disabled,
}: {
  questionId: string;
  maxLength: number;
  value: Extract<QuestionResponse, { type: "open_answer" }> | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled: boolean;
}) {
  const text = value?.text ?? "";
  const inputId = `q-${questionId}-open-answer`;
  return (
    <div>
      <label htmlFor={inputId} className="sr-only">
        Развёрнутый ответ
      </label>
      <Textarea
        id={inputId}
        rows={5}
        maxLength={maxLength}
        value={text}
        disabled={disabled}
        onChange={(e) =>
          onChange({
            type: "open_answer",
            text: e.target.value,
            attachmentIds: value?.attachmentIds ?? [],
          })
        }
      />
      <p className="mt-1 text-right text-xs text-muted-foreground">
        {text.length} / {maxLength}
      </p>
      <p className="text-xs text-muted-foreground">Проверяется учителем вручную.</p>
    </div>
  );
}

export function ClozeDropdownPlayer({
  questionId,
  template,
  gaps,
  value,
  onChange,
  disabled,
}: {
  questionId: string;
  template: string;
  gaps: Record<string, { options: string[] }>;
  value: Extract<QuestionResponse, { type: "cloze_dropdown" }> | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled: boolean;
}) {
  const parts = splitTemplate(template);
  const values = value?.values ?? {};

  function setGap(gapId: string, selected: string) {
    onChange({ type: "cloze_dropdown", values: { ...values, [gapId]: selected || null } });
  }

  return (
    <p className="text-sm leading-8">
      {parts.map((part, i) =>
        typeof part === "string" ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: sanitizeHtml(part) }} />
        ) : (
          <select
            key={i}
            aria-label={`Пропуск ${part.gapId}`}
            className={INLINE_FIELD}
            value={values[part.gapId] ?? ""}
            disabled={disabled}
            onChange={(e) => setGap(part.gapId, e.target.value)}
          >
            <option value="" disabled>
              …
            </option>
            {gaps[part.gapId]?.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ),
      )}
    </p>
  );
}

export function ClozeTextPlayer({
  template,
  gapIds,
  value,
  onChange,
  disabled,
}: {
  template: string;
  gapIds: string[];
  value: Extract<QuestionResponse, { type: "cloze_text" }> | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled: boolean;
}) {
  const parts = splitTemplate(template);
  const values = value?.values ?? {};

  function setGap(gapId: string, text: string) {
    onChange({ type: "cloze_text", values: { ...values, [gapId]: text } });
  }

  return (
    <p className="text-sm leading-8">
      {parts.map((part, i) =>
        typeof part === "string" ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: sanitizeHtml(part) }} />
        ) : (
          <input
            key={i}
            type="text"
            aria-label={`Пропуск ${part.gapId}`}
            className={`${INLINE_FIELD} w-24`}
            value={values[part.gapId] ?? ""}
            disabled={disabled}
            onChange={(e) => setGap(part.gapId, e.target.value)}
          />
        ),
      )}
      {/* gapIds не используется напрямую (id пропусков уже есть в template) — оставлен в сигнатуре для симметрии с cloze_dropdown, где он приходит той же формы. */}
      {gapIds.length === 0 && null}
    </p>
  );
}

function DraggableChip({ id, html, disabled }: { id: string; html: string; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`cursor-grab rounded-md border border-border bg-card px-2 py-1 text-sm shadow-xs ${isDragging ? "opacity-50" : ""}`}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  );
}

function DroppableSlot({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[2.25rem] min-w-[8rem] rounded-md border border-dashed px-2 py-1 ${isOver ? "border-primary bg-accent" : "border-border"}`}
    >
      {children}
    </div>
  );
}

const POOL_ID = "__pool__";

export function MatchingPlayer({
  left,
  right,
  value,
  onChange,
  disabled,
}: {
  left: { id: string; html: string }[];
  right: { id: string; html: string }[];
  value: Extract<QuestionResponse, { type: "matching" }> | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled: boolean;
}) {
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const pairs = value?.pairs ?? [];
  const assignmentByLeft = new Map(pairs);
  const assignedRightIds = new Set(pairs.map(([, r]) => r));
  const pool = right.filter((r) => !assignedRightIds.has(r.id));

  /** Снимает текущую пару `rightId` (откуда бы она ни была) и, если указан `leftId`, ставит новую — один и тот же путь для drag-and-drop и `<select>`-альтернативы ниже. */
  function assign(leftId: string | null, rightId: string) {
    const withoutRight = pairs.filter(([, r]) => r !== rightId);
    const next = leftId ? [...withoutRight.filter(([l]) => l !== leftId), [leftId, rightId] as [string, string]] : withoutRight;
    onChange({ type: "matching", pairs: next });
  }

  function unassignLeft(leftId: string) {
    onChange({ type: "matching", pairs: pairs.filter(([l]) => l !== leftId) });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const rightId = String(active.id);
    const targetId = String(over.id);
    assign(targetId === POOL_ID ? null : targetId, rightId);
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex flex-col gap-2">
          {left.map((l) => {
            const assignedId = assignmentByLeft.get(l.id);
            const assignedItem = right.find((r) => r.id === assignedId);
            return (
              <div key={l.id} className="flex items-center gap-2">
                <span
                  className="w-32 shrink-0 text-sm"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(l.html) }}
                />
                <DroppableSlot id={l.id}>
                  {assignedItem && <DraggableChip id={assignedItem.id} html={assignedItem.html} disabled={disabled} />}
                </DroppableSlot>
              </div>
            );
          })}
        </div>
        <p className="mb-1 mt-4 text-xs text-muted-foreground">Перетащите варианты к нужной паре:</p>
        <DroppableSlot id={POOL_ID}>
          <div className="flex flex-wrap gap-2">
            {pool.map((r) => (
              <DraggableChip key={r.id} id={r.id} html={r.html} disabled={disabled} />
            ))}
          </div>
        </DroppableSlot>
      </DndContext>

      {/* Клавиатурная альтернатива drag-and-drop (§16 ТЗ) — тот же результат, гарантированно доступна с Tab/стрелками без допущений о курсоре перетаскивания. */}
      <fieldset className="mt-4 flex flex-col gap-1.5">
        <legend className="text-xs text-muted-foreground">Или выберите пару списком:</legend>
        {left.map((l) => (
          <label key={l.id} className="flex items-center gap-2 text-sm">
            <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(l.html) }} />
            <select
              aria-label={`Пара для варианта ${l.id}`}
              className={INLINE_FIELD}
              value={assignmentByLeft.get(l.id) ?? ""}
              disabled={disabled}
              onChange={(e) => (e.target.value ? assign(l.id, e.target.value) : unassignLeft(l.id))}
            >
              <option value="">—</option>
              {right.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.html.replace(/<[^>]+>/g, "")}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

/**
 * Категоризация (тип 11, §6.3/§6.4 ТЗ, Э13 — достройка сверх стоп-листа
 * Э8 по прямому запросу пользователя). Тот же приём, что `MatchingPlayer`
 * выше: DnD-корзины ПЛЮС `<select>` на каждый элемент как гарантированно
 * доступная с клавиатуры альтернатива (§16 ТЗ).
 */
export function CategorizePlayer({
  categories,
  items,
  value,
  onChange,
  disabled,
}: {
  categories: { id: string; label: string }[];
  items: { id: string; html: string }[];
  value: Extract<QuestionResponse, { type: "categorize" }> | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled: boolean;
}) {
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const values = value?.values ?? {};
  const pool = items.filter((i) => values[i.id] == null);

  function place(itemId: string, categoryId: string | null) {
    onChange({ type: "categorize", values: { ...values, [itemId]: categoryId } });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const itemId = String(active.id);
    const targetId = String(over.id);
    place(itemId, targetId === POOL_ID ? null : targetId);
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex flex-wrap gap-3">
          {categories.map((cat) => (
            <div key={cat.id} className="min-w-[10rem] flex-1">
              <p className="mb-1 text-xs font-medium text-muted-foreground">{cat.label}</p>
              <DroppableSlot id={cat.id}>
                <div className="flex flex-wrap gap-1.5">
                  {items
                    .filter((i) => values[i.id] === cat.id)
                    .map((i) => (
                      <DraggableChip key={i.id} id={i.id} html={i.html} disabled={disabled} />
                    ))}
                </div>
              </DroppableSlot>
            </div>
          ))}
        </div>
        <p className="mb-1 mt-4 text-xs text-muted-foreground">Не распределено:</p>
        <DroppableSlot id={POOL_ID}>
          <div className="flex flex-wrap gap-2">
            {pool.map((i) => (
              <DraggableChip key={i.id} id={i.id} html={i.html} disabled={disabled} />
            ))}
          </div>
        </DroppableSlot>
      </DndContext>

      {/* Клавиатурная альтернатива drag-and-drop (§16 ТЗ) — тот же результат, гарантированно доступна с Tab/стрелками без допущений о курсоре перетаскивания. */}
      <fieldset className="mt-4 flex flex-col gap-1.5">
        <legend className="text-xs text-muted-foreground">Или выберите категорию списком:</legend>
        {items.map((i) => (
          <label key={i.id} className="flex items-center gap-2 text-sm">
            <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(i.html) }} />
            <select
              aria-label={`Категория для ${i.id}`}
              className={INLINE_FIELD}
              value={values[i.id] ?? ""}
              disabled={disabled}
              onChange={(e) => place(i.id, e.target.value || null)}
            >
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

function SortableOrderingItem({
  id,
  html,
  onMove,
  disabled,
  isFirst,
  isLast,
}: {
  id: string;
  html: string;
  onMove: (direction: -1 | 1) => void;
  disabled: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-sm ${isDragging ? "opacity-50 shadow-md" : ""}`}
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab select-none text-muted-foreground"
        aria-hidden="true"
      >
        <GripVertical className="size-4" />
      </span>
      <span className="flex-1" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
      {/* Кнопки — та же клавиатурная гарантия, что select у matching. */}
      <button
        type="button"
        disabled={disabled || isFirst}
        onClick={() => onMove(-1)}
        aria-label="Переместить выше"
        className="rounded-md border border-border p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30"
      >
        <ChevronUp className="size-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled || isLast}
        onClick={() => onMove(1)}
        aria-label="Переместить ниже"
        className="rounded-md border border-border p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30"
      >
        <ChevronDown className="size-3.5" />
      </button>
    </li>
  );
}

export function OrderingPlayer({
  items,
  value,
  onChange,
  disabled,
}: {
  items: { id: string; html: string }[];
  value: Extract<QuestionResponse, { type: "ordering" }> | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled: boolean;
}) {
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  // Порядок в ответе может отставать от items (первый рендер) — если ответа ещё нет, стартуем с порядка, в котором сервер уже отдал items (перемешан на сервере, Э8.1).
  const [order, setOrder] = useState<string[]>(value?.order ?? items.map((i) => i.id));
  const byId = new Map(items.map((i) => [i.id, i]));

  function commit(next: string[]) {
    setOrder(next);
    onChange({ type: "ordering", order: next });
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    commit(next);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    commit(arrayMove(order, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-1">
          {order.map((id, index) => {
            const item = byId.get(id);
            if (!item) return null;
            return (
              <SortableOrderingItem
                key={id}
                id={id}
                html={item.html}
                disabled={disabled}
                isFirst={index === 0}
                isLast={index === order.length - 1}
                onMove={(direction) => move(index, direction)}
              />
            );
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
