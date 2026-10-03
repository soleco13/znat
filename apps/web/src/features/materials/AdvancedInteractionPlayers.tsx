import { useState } from "react";
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
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import type { QuestionResponse } from "@school/shared";

import { sanitizeHtml } from "@/shared/sanitize-html";


/**
 * Плеер заданий, типы 6–11 (продолжение `QuestionPlayer.tsx`): open_answer,
 * cloze_dropdown, cloze_text, matching, ordering, categorize. Оформление —
 * textbook/textbook.css. Все типы управляются с клавиатуры (§16 ТЗ): выбор
 * в matching/categorize — обычные кнопки, порядок в ordering — кнопки
 * «выше/ниже» плюс перетаскивание (`dnd-kit`, клавиатурный сенсор).
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
      <div className="tb-open">
        <textarea
          id={inputId}
          rows={5}
          maxLength={maxLength}
          placeholder="Ваш ответ"
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
        <div className="tb-open-foot">
          <span>Проверяется учителем вручную</span>
          <span>
            {text.length} / {maxLength}
          </span>
        </div>
      </div>
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
    <p className="tb-cloze">
      {parts.map((part, i) =>
        typeof part === "string" ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: sanitizeHtml(part) }} />
        ) : (
          <select
            key={i}
            aria-label={`Пропуск ${part.gapId}`}
            className="tb-gap-select"
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
    <p className="tb-cloze">
      {parts.map((part, i) =>
        typeof part === "string" ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: sanitizeHtml(part) }} />
        ) : (
          <input
            key={i}
            type="text"
            aria-label={`Пропуск ${part.gapId}`}
            className="tb-gap-input"
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

/**
 * Сопоставление: у каждой строки — ряд плашек со вторыми половинами пар.
 * Нажатие выбирает пару, повторное снимает; вторая половина занята одной
 * строкой, поэтому выбор её в другой строке переносит пару. Перетаскивания
 * нет: на телефоне оно спорит со скроллом, а кнопки доступны с клавиатуры (§16 ТЗ).
 */
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
  const pairs = value?.pairs ?? [];
  const assignmentByLeft = new Map(pairs);

  /** Снимает текущую пару `rightId` (откуда бы она ни была) и ставит новую для `leftId`. */
  function assign(leftId: string, rightId: string) {
    const rest = pairs.filter(([l, r]) => r !== rightId && l !== leftId);
    onChange({ type: "matching", pairs: [...rest, [leftId, rightId] as [string, string]] });
  }

  function unassignLeft(leftId: string) {
    onChange({ type: "matching", pairs: pairs.filter(([l]) => l !== leftId) });
  }

  return (
    <div className="tb-pairs" role="group" aria-label="Сопоставьте пары">
      {left.map((l) => {
        const assignedId = assignmentByLeft.get(l.id);
        return (
          <div key={l.id} className="tb-pair">
            <span
              className="tb-pair-label"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(l.html) }}
            />
            <div className="tb-chips">
              {right.map((r) => {
                const on = assignedId === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    className="tb-chip"
                    aria-pressed={on}
                    disabled={disabled}
                    onClick={() => (on ? unassignLeft(l.id) : assign(l.id, r.id))}
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(r.html) }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Распределение (тип 11): нажмите на слово, затем на столбец. Слово в столбце
 * возвращается обратно по нажатию. Как и сопоставление, без перетаскивания.
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
  const [selected, setSelected] = useState<string | null>(null);
  const values = value?.values ?? {};
  const pool = items.filter((i) => values[i.id] == null);

  function place(itemId: string, categoryId: string | null) {
    onChange({ type: "categorize", values: { ...values, [itemId]: categoryId } });
  }

  function drop(categoryId: string) {
    if (!selected || disabled) return;
    place(selected, categoryId);
    setSelected(null);
  }

  return (
    <div className="tb-cat">
      <div className="tb-cat-pool" role="group" aria-label="Не распределено">
        {pool.map((i) => (
          <button
            key={i.id}
            type="button"
            className="tb-word"
            aria-pressed={selected === i.id}
            disabled={disabled}
            onClick={() => setSelected(selected === i.id ? null : i.id)}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(i.html) }}
          />
        ))}
        {pool.length === 0 ? <span className="tb-cat-note self-center">Всё распределено</span> : null}
      </div>
      <div className="tb-bins">
        {categories.map((cat) => {
          const armed = selected !== null && !disabled;
          return (
            <div
              key={cat.id}
              className="tb-bin"
              data-armed={armed}
              onClick={armed ? () => drop(cat.id) : undefined}
            >
              <span className="tb-bin-label">{cat.label}</span>
              <div className="tb-chips">
                {items
                  .filter((i) => values[i.id] === cat.id)
                  .map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      className="tb-word"
                      aria-label={`Вернуть «${i.html.replace(/<[^>]+>/g, "")}»`}
                      disabled={disabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        place(i.id, null);
                      }}
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(i.html) }}
                    />
                  ))}
              </div>
              {armed ? (
                <button
                  type="button"
                  className="tb-textbtn mt-auto self-start"
                  onClick={(e) => {
                    e.stopPropagation();
                    drop(cat.id);
                  }}
                >
                  Положить сюда
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <span className="tb-cat-note">
        Нажмите на слово, затем на столбец. Нажатие на слово в столбце вернёт его обратно.
      </span>
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
  position,
}: {
  id: string;
  html: string;
  position: number;
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
      className="tb-order-item"
      data-dragging={isDragging}
    >
      <span
        {...attributes}
        {...listeners}
        // `touch-action: none` (в CSS) — иначе тач-драг ручки конфликтует со скроллом.
        className="tb-order-grip"
        aria-hidden="true"
      >
        <GripVertical />
      </span>
      <span className="tb-order-n">{position}</span>
      <span className="tb-order-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
      {/* Кнопки — та же клавиатурная гарантия, что select у matching. */}
      <button
        type="button"
        disabled={disabled || isFirst}
        onClick={() => onMove(-1)}
        aria-label="Переместить выше"
        className="tb-iconbtn tb-iconbtn--muted"
      >
        <ChevronUp />
      </button>
      <button
        type="button"
        disabled={disabled || isLast}
        onClick={() => onMove(1)}
        aria-label="Переместить ниже"
        className="tb-iconbtn tb-iconbtn--muted"
      >
        <ChevronDown />
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
  // `activationConstraint` — короткое смещение перед стартом драга, иначе
  // на тач-устройстве обычный скролл-жест сам запускает перетаскивание.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
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
        <ul className="tb-order">
          {order.map((id, index) => {
            const item = byId.get(id);
            if (!item) return null;
            return (
              <SortableOrderingItem
                key={id}
                id={id}
                html={item.html}
                disabled={disabled}
                position={index + 1}
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
