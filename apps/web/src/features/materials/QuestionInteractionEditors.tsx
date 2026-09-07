import { useId, useRef, useState, type ReactNode } from "react";
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
import { ChevronDown, ChevronUp, GripVertical, Plus, X } from "lucide-react";
import type { QuestionInteraction, RubricCriterion, TextMatchRule } from "@school/shared";

/**
 * Редакторы вариантов ответа/ключа для всех 10 типов (§6.3 ТЗ): 1–5
 * (Э9.5 — `single_choice`/`multiple_choice`/`true_false`/`text_input`/
 * `numeric_input`) и 6–10 (Э9.6 — `open_answer`/`cloze_dropdown`/
 * `cloze_text`/`matching`/`ordering`) — то, что `QuestionBlockFields`
 * (Э9.2) явно оставляла заглушкой («Варианты ответа/ключ редактируются в
 * редакторе вопроса»).
 *
 * Подписи вариантов/ответов/элементов — ПРОСТОЙ `<input>`, не
 * `RichTextEditor` (Э9.4): та подзадача — про ФОРМУЛИРОВКИ (`prompt`/
 * `hint`/`rich_text`/`callout`, целые абзацы), а не про короткие ярлыки —
 * тулбар Tiptap на каждой строке списка был бы визуальным шумом, а не
 * удобством. Поля в схеме типизированы как `html: string` (`choiceOptionSchema`,
 * `matchingItemSchema`, `orderingItemSchema`), но простой текст — валидное
 * значение html-поля без единого тега; форматирование ВНУТРИ варианта,
 * если понадобится, — отдельная задача, не блокирует MVP десяти типов
 * (стоп-лист Э9).
 */
export function InteractionEditor({
  interaction,
  onChange,
}: {
  interaction: QuestionInteraction;
  onChange: (interaction: QuestionInteraction) => void;
}) {
  switch (interaction.type) {
    case "single_choice":
      return <ChoiceOptionsEditor interaction={interaction} onChange={onChange} multiple={false} />;
    case "multiple_choice":
      return <ChoiceOptionsEditor interaction={interaction} onChange={onChange} multiple={true} />;
    case "true_false":
      return <TrueFalseEditor interaction={interaction} onChange={onChange} />;
    case "text_input":
      return <TextInputEditor interaction={interaction} onChange={onChange} />;
    case "numeric_input":
      return <NumericInputEditor interaction={interaction} onChange={onChange} />;
    case "open_answer":
      return <OpenAnswerEditor interaction={interaction} onChange={onChange} />;
    case "cloze_dropdown":
      return <ClozeDropdownEditor interaction={interaction} onChange={onChange} />;
    case "cloze_text":
      return <ClozeTextEditor interaction={interaction} onChange={onChange} />;
    case "matching":
      return <MatchingEditor interaction={interaction} onChange={onChange} />;
    case "ordering":
      return <OrderingEditor interaction={interaction} onChange={onChange} />;
    case "categorize":
      return <CategorizeEditor interaction={interaction} onChange={onChange} />;
    case "highlight_text":
      return <HighlightTextEditor interaction={interaction} onChange={onChange} />;
    case "table_fill":
      return <TableFillEditor interaction={interaction} onChange={onChange} />;
  }
}

/** `matchingItemSchema`/`orderingItemSchema` — одна и та же форма `{id, html}`, объявленная в схеме дважды под разными именами; здесь один общий тип вместо двух одинаковых `Extract<...>`. */
type IdHtmlItem = { id: string; html: string };

// ─── single_choice / multiple_choice ────────────────────────────────────────

function ChoiceOptionsEditor({
  interaction,
  onChange,
  multiple,
}: {
  interaction: Extract<QuestionInteraction, { type: "single_choice" | "multiple_choice" }>;
  onChange: (interaction: QuestionInteraction) => void;
  multiple: boolean;
}) {
  const groupName = useId();

  function setOptions(options: typeof interaction.options) {
    onChange({ ...interaction, options });
  }

  function addOption() {
    setOptions([...interaction.options, { id: crypto.randomUUID(), html: "", correct: false }]);
  }

  function removeOption(id: string) {
    if (interaction.options.length <= 2) return;
    setOptions(interaction.options.filter((o) => o.id !== id));
  }

  function setCorrect(id: string, correct: boolean) {
    // single_choice — ровно один правильный, переключение работает как радио (сброс остальных).
    setOptions(interaction.options.map((o) => ({ ...o, correct: o.id === id ? correct : multiple ? o.correct : false })));
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={interaction.shuffle}
          onChange={(e) => onChange({ ...interaction, shuffle: e.target.checked })}
        />
        Перемешивать варианты у ученика
      </label>
      <ul className="flex flex-col gap-1.5">
        {interaction.options.map((option) => (
          <li key={option.id} className="flex items-center gap-2">
            <input
              type={multiple ? "checkbox" : "radio"}
              name={multiple ? undefined : groupName}
              checked={option.correct}
              onChange={(e) => setCorrect(option.id, e.target.checked)}
              aria-label="Правильный вариант"
            />
            <input
              value={option.html}
              onChange={(e) =>
                setOptions(interaction.options.map((o) => (o.id === option.id ? { ...o, html: e.target.value } : o)))
              }
              placeholder="Текст варианта"
              className="flex-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
            />
            <button
              type="button"
              onClick={() => removeOption(option.id)}
              disabled={interaction.options.length <= 2}
              aria-label="Удалить вариант"
              className="rounded-md border border-border p-1 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-30"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={addOption}
        className="self-start inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
      >
        <Plus className="size-3" aria-hidden /> Добавить вариант
      </button>
    </div>
  );
}

// ─── true_false ──────────────────────────────────────────────────────────────

function TrueFalseEditor({
  interaction,
  onChange,
}: {
  interaction: Extract<QuestionInteraction, { type: "true_false" }>;
  onChange: (interaction: QuestionInteraction) => void;
}) {
  const groupName = useId();
  return (
    <div className="flex gap-4 text-xs text-muted-foreground">
      <label className="flex items-center gap-1.5">
        <input
          type="radio"
          name={groupName}
          checked={interaction.correct}
          onChange={() => onChange({ ...interaction, correct: true })}
        />
        Верно
      </label>
      <label className="flex items-center gap-1.5">
        <input
          type="radio"
          name={groupName}
          checked={!interaction.correct}
          onChange={() => onChange({ ...interaction, correct: false })}
        />
        Неверно
      </label>
    </div>
  );
}

// ─── text_input ──────────────────────────────────────────────────────────────

function TextInputEditor({
  interaction,
  onChange,
}: {
  interaction: Extract<QuestionInteraction, { type: "text_input" }>;
  onChange: (interaction: QuestionInteraction) => void;
}) {
  return <AnswerRulesFields rules={interaction} onChange={(rules) => onChange({ ...interaction, ...rules })} />;
}

/**
 * Общая форма правил сравнения текстового ответа — одинаковая у
 * `text_input` (интеракция целиком) и у каждого пропуска `cloze_text`
 * (`clozeTextGapSchema`, тот же набор полей без `type`). Вынесено, а не
 * скопировано дважды, потому что различие ровно в одном: у кого лежит
 * этот набор полей — на интеракции или внутри `gaps[id]`.
 */
interface AnswerRules {
  answers: TextMatchRule[];
  caseSensitive: boolean;
  trimWhitespace: boolean;
  typoTolerance: number;
}

const TEXT_MATCH_LABELS: Record<TextMatchRule["match"], string> = {
  exact: "точно",
  normalized: "без учёта регистра/пробелов",
  regex: "рег. выражение",
};

function AnswerRulesFields({ rules, onChange }: { rules: AnswerRules; onChange: (rules: AnswerRules) => void }) {
  function setAnswers(answers: TextMatchRule[]) {
    onChange({ ...rules, answers });
  }

  function addAnswer() {
    setAnswers([...rules.answers, { value: "", match: "exact" }]);
  }

  function removeAnswer(index: number) {
    if (rules.answers.length <= 1) return;
    setAnswers(rules.answers.filter((_, i) => i !== index));
  }

  function updateAnswer(index: number, patch: Partial<TextMatchRule>) {
    setAnswers(rules.answers.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1.5">
        {rules.answers.map((answer, i) => (
          // Без стабильного id в схеме (`textMatchRuleSchema`) — ключ по индексу,
          // как и у строк таблицы в `ContentBlockFields`; список не переупорядочивается.
          <li key={i} className="flex items-center gap-2">
            <input
              value={answer.value}
              onChange={(e) => updateAnswer(i, { value: e.target.value })}
              placeholder="Правильный ответ"
              className="flex-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
            />
            <select
              value={answer.match}
              onChange={(e) => updateAnswer(i, { match: e.target.value as TextMatchRule["match"] })}
              className="rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none focus-visible:border-primary"
            >
              {(Object.keys(TEXT_MATCH_LABELS) as TextMatchRule["match"][]).map((m) => (
                <option key={m} value={m}>
                  {TEXT_MATCH_LABELS[m]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => removeAnswer(i)}
              disabled={rules.answers.length <= 1}
              aria-label="Удалить вариант ответа"
              className="rounded-md border border-border p-1 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-30"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={addAnswer}
        className="self-start inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
      >
        <Plus className="size-3" aria-hidden /> Добавить вариант ответа
      </button>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={rules.caseSensitive}
          onChange={(e) => onChange({ ...rules, caseSensitive: e.target.checked })}
        />
        Учитывать регистр
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={rules.trimWhitespace}
          onChange={(e) => onChange({ ...rules, trimWhitespace: e.target.checked })}
        />
        Игнорировать пробелы по краям
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Допуск опечаток (расстояние Левенштейна)
        <input
          type="number"
          min={0}
          value={rules.typoTolerance}
          onChange={(e) => onChange({ ...rules, typoTolerance: Number(e.target.value) || 0 })}
          className="w-16 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
        />
      </label>
    </div>
  );
}

// ─── numeric_input ───────────────────────────────────────────────────────────

function NumericInputEditor({
  interaction,
  onChange,
}: {
  interaction: Extract<QuestionInteraction, { type: "numeric_input" }>;
  onChange: (interaction: QuestionInteraction) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Правильное значение
        <input
          type="number"
          value={interaction.value}
          onChange={(e) => onChange({ ...interaction, value: Number(e.target.value) || 0 })}
          className="w-28 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
        />
      </label>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        Допуск
        <select
          value={interaction.tolerance.kind}
          onChange={(e) =>
            onChange({
              ...interaction,
              tolerance: { ...interaction.tolerance, kind: e.target.value as typeof interaction.tolerance.kind },
            })
          }
          className="rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none focus-visible:border-primary"
        >
          <option value="absolute">± абсолютный</option>
          <option value="relative">относительный</option>
          <option value="percent">%</option>
        </select>
        <input
          type="number"
          min={0}
          value={interaction.tolerance.value}
          onChange={(e) =>
            onChange({ ...interaction, tolerance: { ...interaction.tolerance, value: Number(e.target.value) || 0 } })
          }
          className="w-24 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Единица измерения (необязательно)
        <input
          value={interaction.unit ?? ""}
          onChange={(e) => onChange({ ...interaction, unit: e.target.value || undefined })}
          className="w-28 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
        />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={interaction.unitRequired}
          onChange={(e) => onChange({ ...interaction, unitRequired: e.target.checked })}
        />
        Единица измерения обязательна в ответе
      </label>
    </div>
  );
}

// ─── open_answer (Э9.6) ──────────────────────────────────────────────────────

function OpenAnswerEditor({
  interaction,
  onChange,
}: {
  interaction: Extract<QuestionInteraction, { type: "open_answer" }>;
  onChange: (interaction: QuestionInteraction) => void;
}) {
  function setRubric(rubric: RubricCriterion[]) {
    onChange({ ...interaction, rubric });
  }

  function addCriterion() {
    setRubric([...interaction.rubric, { id: crypto.randomUUID(), label: "", points: 1 }]);
  }

  function removeCriterion(id: string) {
    if (interaction.rubric.length <= 1) return;
    setRubric(interaction.rubric.filter((c) => c.id !== id));
  }

  function updateCriterion(id: string, patch: Partial<RubricCriterion>) {
    setRubric(interaction.rubric.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Максимальная длина ответа (символов)
        <input
          type="number"
          min={1}
          value={interaction.maxLength}
          onChange={(e) => onChange({ ...interaction, maxLength: Math.max(1, Number(e.target.value) || 1) })}
          className="w-24 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
        />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={interaction.allowAttachments}
          onChange={(e) => onChange({ ...interaction, allowAttachments: e.target.checked })}
        />
        Разрешить прикреплять файлы
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Критерии проверки — учитель видит их при ручной проверке</span>
        <ul className="flex flex-col gap-1.5">
          {interaction.rubric.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <input
                value={c.label}
                onChange={(e) => updateCriterion(c.id, { label: e.target.value })}
                placeholder="Критерий"
                className="flex-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
              />
              <input
                type="number"
                min={0}
                value={c.points}
                onChange={(e) => updateCriterion(c.id, { points: Number(e.target.value) || 0 })}
                className="w-16 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
              />
              <button
                type="button"
                onClick={() => removeCriterion(c.id)}
                disabled={interaction.rubric.length <= 1}
                aria-label="Удалить критерий"
                className="rounded-md border border-border p-1 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-30"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={addCriterion}
          className="self-start inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
        >
          <Plus className="size-3" aria-hidden /> Добавить критерий
        </button>
      </div>
    </div>
  );
}

// ─── cloze_dropdown / cloze_text (Э9.6) — общий каркас шаблона с пропусками ──

type ClozeDropdownInteraction = Extract<QuestionInteraction, { type: "cloze_dropdown" }>;
type ClozeDropdownGap = ClozeDropdownInteraction["gaps"][string];
type ClozeTextInteraction = Extract<QuestionInteraction, { type: "cloze_text" }>;
type ClozeTextGap = ClozeTextInteraction["gaps"][string];

/** id ещё не занят ни в тексте шаблона, ни в уже сохранённых `gaps` (осиротевший гэп, см. `orphanIds` ниже, тоже занимает свой id). */
function nextGapId(template: string, gaps: Record<string, unknown>): string {
  const used = new Set<number>();
  const remember = (id: string) => {
    const m = /^gap(\d+)$/.exec(id);
    if (m) used.add(Number(m[1]));
  };
  for (const m of template.matchAll(/\{\{(\w+)\}\}/g)) remember(m[1]!);
  for (const id of Object.keys(gaps)) remember(id);
  let n = 1;
  while (used.has(n)) n++;
  return `gap${n}`;
}

/** id пропусков в порядке первого появления в шаблоне, без повторов — тот же паттерн разбора `{{gapId}}`, что `splitTemplate` в `AdvancedInteractionPlayers.tsx` (плеер), только тут нужны только id, не сегменты текста. */
function templateGapIds(template: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of template.matchAll(/\{\{(\w+)\}\}/g)) {
    const id = m[1]!;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Общий каркас для `cloze_dropdown`/`cloze_text`: textarea шаблона +
 * кнопка «Добавить пропуск» (вставляет `{{gapN}}` в позицию курсора через
 * `HTMLTextAreaElement.setRangeText`, не просто в конец — писать `{{gapN}}`
 * руками неудобно и ошибкоопасно, отсюда вообще кнопка) + карточка-редактор
 * на каждый пропуск, реально встречающийся в шаблоне (`renderGap` — то,
 * чем `cloze_dropdown`/`cloze_text` различаются, содержимое гэпа).
 *
 * Осиротевшие записи `gaps` (id из уже сохранённого JSON, которого
 * БОЛЬШЕ НЕТ в тексте — методист стёр или сломал токен вручную) не
 * удаляются молча при каждой правке textarea: пока идёт правка, шаблон
 * может временно не содержать валидный `{{...}}` (например, набирает
 * закрывающую скобку) — удалять конфигурацию гэпа в этот момент значило
 * бы тихо терять работу методиста. Вместо этого — отдельная строка с
 * кнопкой «Удалить неиспользуемые», решение явное и по требованию.
 */
function ClozeTemplateShell<Gap>({
  template,
  gaps,
  defaultGap,
  onChange,
  renderGap,
}: {
  template: string;
  gaps: Record<string, Gap>;
  defaultGap: Gap;
  onChange: (template: string, gaps: Record<string, Gap>) => void;
  renderGap: (gap: Gap, onGapChange: (gap: Gap) => void) => ReactNode;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function insertGap() {
    const id = nextGapId(template, gaps);
    const token = `{{${id}}}`;
    const el = textareaRef.current;
    let newTemplate: string;
    if (el) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      el.focus();
      el.setRangeText(token, start, end, "end");
      newTemplate = el.value;
    } else {
      newTemplate = template ? `${template} ${token}` : token;
    }
    onChange(newTemplate, { ...gaps, [id]: defaultGap });
  }

  function removeGap(id: string) {
    const newTemplate = template.replaceAll(`{{${id}}}`, "");
    const rest = { ...gaps };
    delete rest[id];
    onChange(newTemplate, rest);
  }

  function removeOrphans(ids: string[]) {
    const rest = { ...gaps };
    for (const id of ids) delete rest[id];
    onChange(template, rest);
  }

  const usedIds = templateGapIds(template);
  const orphanIds = Object.keys(gaps).filter((id) => !usedIds.includes(id));

  return (
    <div className="flex flex-col gap-2">
      <label className="block text-xs text-muted-foreground">
        Текст с пропусками
        <textarea
          ref={textareaRef}
          value={template}
          onChange={(e) => onChange(e.target.value, gaps)}
          rows={3}
          className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
        />
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          Пропуск в тексте выглядит как {"{{gap1}}"} — вставляется кнопкой ниже, руками писать не нужно
        </span>
      </label>
      <button
        type="button"
        onClick={insertGap}
        className="self-start inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
      >
        <Plus className="size-3" aria-hidden /> Добавить пропуск
      </button>
      {usedIds.length === 0 && <p className="text-xs text-muted-foreground">В тексте пока нет ни одного пропуска.</p>}
      {usedIds.map((id) => (
        <div key={id} className="rounded-md border border-border p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Пропуск {`{{${id}}}`}</span>
            <button
              type="button"
              onClick={() => removeGap(id)}
              className="rounded-md border border-border px-1.5 py-0.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              Удалить пропуск
            </button>
          </div>
          {renderGap(gaps[id] ?? defaultGap, (gap) => onChange(template, { ...gaps, [id]: gap }))}
        </div>
      ))}
      {orphanIds.length > 0 && (
        <p className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
          В тексте больше не упоминаются: {orphanIds.map((id) => `{{${id}}}`).join(", ")}.{" "}
          <button type="button" onClick={() => removeOrphans(orphanIds)} className="underline">
            Удалить неиспользуемые
          </button>
        </p>
      )}
    </div>
  );
}

function ClozeDropdownEditor({
  interaction,
  onChange,
}: {
  interaction: ClozeDropdownInteraction;
  onChange: (interaction: QuestionInteraction) => void;
}) {
  return (
    <ClozeTemplateShell
      template={interaction.template}
      gaps={interaction.gaps}
      defaultGap={{ options: ["", ""], correct: "" }}
      onChange={(template, gaps) => onChange({ ...interaction, template, gaps })}
      renderGap={(gap, onGapChange) => <ClozeDropdownGapFields gap={gap} onChange={onGapChange} />}
    />
  );
}

function ClozeDropdownGapFields({ gap, onChange }: { gap: ClozeDropdownGap; onChange: (gap: ClozeDropdownGap) => void }) {
  function setOptions(options: string[]) {
    onChange({ ...gap, options });
  }

  function addOption() {
    setOptions([...gap.options, ""]);
  }

  function removeOption(index: number) {
    if (gap.options.length <= 2) return;
    setOptions(gap.options.filter((_, i) => i !== index));
  }

  function updateOption(index: number, value: string) {
    const options = gap.options.map((o, i) => (i === index ? value : o));
    // Правильный вариант хранится СТРОКОЙ-значением (не индексом, `clozeDropdownGapSchema`)
    // — если редактируемый текст совпадал с текущим `correct`, переносим и его,
    // иначе переименование варианта молча отвязало бы от него правильный ответ.
    const correct = gap.options[index] === gap.correct ? value : gap.correct;
    onChange({ ...gap, options, correct });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-1">
        {gap.options.map((option, i) => (
          <li key={i} className="flex items-center gap-2">
            <input
              value={option}
              onChange={(e) => updateOption(i, e.target.value)}
              placeholder="Вариант"
              className="flex-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
            />
            <button
              type="button"
              onClick={() => removeOption(i)}
              disabled={gap.options.length <= 2}
              aria-label="Удалить вариант"
              className="rounded-md border border-border p-1 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-30"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={addOption}
        className="self-start inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
      >
        <Plus className="size-3" aria-hidden /> Добавить вариант
      </button>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Правильный вариант
        <select
          value={gap.options.includes(gap.correct) ? gap.correct : ""}
          onChange={(e) => onChange({ ...gap, correct: e.target.value })}
          className="rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none focus-visible:border-primary"
        >
          <option value="" disabled>
            — выберите —
          </option>
          {gap.options.map((option, i) => (
            <option key={i} value={option}>
              {option || `(вариант ${i + 1})`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ClozeTextEditor({
  interaction,
  onChange,
}: {
  interaction: ClozeTextInteraction;
  onChange: (interaction: QuestionInteraction) => void;
}) {
  return (
    <ClozeTemplateShell
      template={interaction.template}
      gaps={interaction.gaps}
      defaultGap={{ answers: [{ value: "", match: "exact" }], caseSensitive: false, trimWhitespace: true, typoTolerance: 0 } as ClozeTextGap}
      onChange={(template, gaps) => onChange({ ...interaction, template, gaps })}
      renderGap={(gap, onGapChange) => <AnswerRulesFields rules={gap} onChange={onGapChange} />}
    />
  );
}

// ─── matching (Э9.6) ─────────────────────────────────────────────────────────

function ItemListEditor({
  label,
  items,
  onChange,
  minItems = 1,
}: {
  label: string;
  items: IdHtmlItem[];
  onChange: (items: IdHtmlItem[]) => void;
  minItems?: number;
}) {
  function addItem() {
    onChange([...items, { id: crypto.randomUUID(), html: "" }]);
  }

  function removeItem(id: string) {
    if (items.length <= minItems) return;
    onChange(items.filter((i) => i.id !== id));
  }

  function updateItem(id: string, html: string) {
    onChange(items.map((i) => (i.id === id ? { ...i, html } : i)));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-1.5">
            <input
              value={item.html}
              onChange={(e) => updateItem(item.id, e.target.value)}
              placeholder="Текст"
              className="flex-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
            />
            <button
              type="button"
              onClick={() => removeItem(item.id)}
              disabled={items.length <= minItems}
              aria-label="Удалить"
              className="rounded-md border border-border p-1 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-30"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={addItem} className="self-start inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary">
        <Plus className="size-3" aria-hidden /> Добавить
      </button>
    </div>
  );
}

/**
 * `distractors` считается автоматически как «id элементов `right` без
 * пары» — ровно то, что и написано в комментарии схемы
 * (`matchingInteractionSchema.distractors`, `materials.ts`): отдельного
 * ручного переключателя «это отвлекающий вариант» нет и не нужно, поле
 * целиком выводимо из `right`/`pairs`. Проверено по `grading.ts` — при
 * подсчёте баллов `distractors` не используется вовсе, только
 * прокидывается ученику как есть (`stripInteractionAnswerKey`), так что
 * пересчёт при каждой правке ничего не ломает в проверке ответов.
 */
function MatchingEditor({
  interaction,
  onChange,
}: {
  interaction: Extract<QuestionInteraction, { type: "matching" }>;
  onChange: (interaction: QuestionInteraction) => void;
}) {
  function recomputeDistractors(right: IdHtmlItem[], pairs: [string, string][]) {
    return right.filter((r) => !pairs.some(([, rid]) => rid === r.id)).map((r) => r.id);
  }

  function setLeft(left: IdHtmlItem[]) {
    const ids = new Set(left.map((l) => l.id));
    const pairs = interaction.pairs.filter(([l]) => ids.has(l));
    onChange({ ...interaction, left, pairs });
  }

  function setRight(right: IdHtmlItem[]) {
    const ids = new Set(right.map((r) => r.id));
    const pairs = interaction.pairs.filter(([, r]) => ids.has(r));
    onChange({ ...interaction, right, pairs, distractors: recomputeDistractors(right, pairs) });
  }

  function setPair(leftId: string, rightId: string | null) {
    let pairs = interaction.pairs.filter(([l]) => l !== leftId);
    if (rightId) {
      // один правый элемент — не более одной пары одновременно, иначе непонятно, что показывать ученику как "правильную" пару у второго левого элемента.
      pairs = pairs.filter(([, r]) => r !== rightId);
      pairs = [...pairs, [leftId, rightId]];
    }
    onChange({ ...interaction, pairs, distractors: recomputeDistractors(interaction.right, pairs) });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <ItemListEditor label="Левый список" items={interaction.left} onChange={setLeft} />
        <ItemListEditor label="Правый список" items={interaction.right} onChange={setRight} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Пары</span>
        {interaction.left.map((l) => {
          const pair = interaction.pairs.find(([lid]) => lid === l.id);
          return (
            <div key={l.id} className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate">{l.html || "(пусто)"}</span>
              <span aria-hidden="true">→</span>
              <select
                value={pair?.[1] ?? ""}
                onChange={(e) => setPair(l.id, e.target.value || null)}
                className="flex-1 rounded-md border border-border bg-card px-2 py-1.5 outline-none focus-visible:border-primary"
              >
                <option value="">— без пары —</option>
                {interaction.right.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.html || "(пусто)"}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Начисление баллов
        <select
          value={interaction.scoring}
          onChange={(e) => onChange({ ...interaction, scoring: e.target.value as typeof interaction.scoring })}
          className="rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none focus-visible:border-primary"
        >
          <option value="all_or_nothing">всё или ничего</option>
          <option value="partial">частично за каждую пару</option>
        </select>
      </label>
      {interaction.distractors.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Без пары (отвлекающие варианты справа):{" "}
          {interaction.right
            .filter((r) => interaction.distractors.includes(r.id))
            .map((r) => r.html || "(пусто)")
            .join(", ")}
        </p>
      )}
    </div>
  );
}

// ─── categorize (тип 11, §6.3 ТЗ, Э13 — достройка сверх стоп-листа Э8 по прямому запросу пользователя) ──

function CategoryListEditor({
  categories,
  onChange,
}: {
  categories: { id: string; label: string }[];
  onChange: (categories: { id: string; label: string }[]) => void;
}) {
  function addCategory() {
    onChange([...categories, { id: crypto.randomUUID(), label: "" }]);
  }
  function removeCategory(id: string) {
    if (categories.length <= 2) return;
    onChange(categories.filter((c) => c.id !== id));
  }
  function updateCategory(id: string, label: string) {
    onChange(categories.map((c) => (c.id === id ? { ...c, label } : c)));
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">Категории (корзины)</span>
      <ul className="flex flex-col gap-1.5">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-1.5">
            <input
              value={c.label}
              onChange={(e) => updateCategory(c.id, e.target.value)}
              placeholder="Название категории"
              className="flex-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
            />
            <button
              type="button"
              onClick={() => removeCategory(c.id)}
              disabled={categories.length <= 2}
              aria-label="Удалить категорию"
              className="rounded-md border border-border p-1 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-30"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={addCategory}
        className="self-start inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
      >
        <Plus className="size-3" aria-hidden /> Добавить категорию
      </button>
    </div>
  );
}

/**
 * `categoryId` — обязательное поле (схема), поэтому при удалении категории
 * её элементы переезжают на первую оставшуюся — интерактив остаётся
 * структурно валидным без «повисших» ссылок, а не превращается в задание
 * без ключа ответа.
 */
function CategorizeEditor({
  interaction,
  onChange,
}: {
  interaction: Extract<QuestionInteraction, { type: "categorize" }>;
  onChange: (interaction: QuestionInteraction) => void;
}) {
  function setCategories(categories: { id: string; label: string }[]) {
    const ids = new Set(categories.map((c) => c.id));
    const fallback = categories[0]?.id ?? "";
    const items = interaction.items.map((i) => (ids.has(i.categoryId) ? i : { ...i, categoryId: fallback }));
    onChange({ ...interaction, categories, items });
  }

  function addItem() {
    onChange({
      ...interaction,
      items: [...interaction.items, { id: crypto.randomUUID(), html: "", categoryId: interaction.categories[0]!.id }],
    });
  }

  function removeItem(id: string) {
    if (interaction.items.length <= 2) return;
    onChange({ ...interaction, items: interaction.items.filter((i) => i.id !== id) });
  }

  function updateItemHtml(id: string, html: string) {
    onChange({ ...interaction, items: interaction.items.map((i) => (i.id === id ? { ...i, html } : i)) });
  }

  function updateItemCategory(id: string, categoryId: string) {
    onChange({ ...interaction, items: interaction.items.map((i) => (i.id === id ? { ...i, categoryId } : i)) });
  }

  return (
    <div className="flex flex-col gap-3">
      <CategoryListEditor categories={interaction.categories} onChange={setCategories} />
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Элементы</span>
        <ul className="flex flex-col gap-1.5">
          {interaction.items.map((item) => (
            <li key={item.id} className="flex items-center gap-1.5">
              <input
                value={item.html}
                onChange={(e) => updateItemHtml(item.id, e.target.value)}
                placeholder="Текст элемента"
                className="flex-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
              />
              <select
                value={item.categoryId}
                onChange={(e) => updateItemCategory(item.id, e.target.value)}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none focus-visible:border-primary"
              >
                {interaction.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label || "(без названия)"}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                disabled={interaction.items.length <= 2}
                aria-label="Удалить элемент"
                className="rounded-md border border-border p-1 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-30"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={addItem}
          className="self-start inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
        >
          <Plus className="size-3" aria-hidden /> Добавить элемент
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={interaction.shuffle}
          onChange={(e) => onChange({ ...interaction, shuffle: e.target.checked })}
        />
        Перемешивать порядок элементов ученику
      </label>
    </div>
  );
}

// ─── highlight_text (тип 14, §6.3 ТЗ, Э13 — достройка сверх стоп-листа Э8) ──

/**
 * Методист печатает предложение целиком в текстовое поле — «Разбить на
 * слова» разбивает по пробелам и заводит по токену на слово (best-effort
 * сохраняет `correct` у слов с тем же текстом на той же позиции, чтобы
 * повторное разбиение не сбрасывало уже расставленные отметки). Дальше —
 * клик по слову переключает «это одно из искомых» (зелёным), как у
 * `ChoiceInline` в `question-view.tsx`.
 */
function HighlightTextEditor({
  interaction,
  onChange,
}: {
  interaction: Extract<QuestionInteraction, { type: "highlight_text" }>;
  onChange: (interaction: QuestionInteraction) => void;
}) {
  const [draft, setDraft] = useState(interaction.tokens.map((t) => t.text).join(" "));

  function regenerate() {
    const words = draft.split(/\s+/).filter(Boolean);
    if (words.length < 2) return;
    const tokens = words.map((text, i) => {
      const prev = interaction.tokens[i];
      return { id: prev?.id ?? crypto.randomUUID(), text, correct: prev?.text === text ? prev.correct : false };
    });
    onChange({ ...interaction, tokens });
  }

  function toggleCorrect(id: string) {
    onChange({
      ...interaction,
      tokens: interaction.tokens.map((t) => (t.id === id ? { ...t, correct: !t.correct } : t)),
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Текст (слова через пробел)
        <div className="flex gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="flex-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
          />
          <button
            type="button"
            onClick={regenerate}
            className="self-start rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
          >
            Разбить на слова
          </button>
        </div>
      </label>
      <div className="flex flex-wrap gap-1.5">
        {interaction.tokens.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => toggleCorrect(t.id)}
            className={`rounded-md border px-2 py-1 text-sm transition-colors ${
              t.correct ? "border-success bg-success-light font-medium text-success" : "border-border hover:bg-secondary"
            }`}
          >
            {t.text}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Зелёным — слова, которые ученику нужно выделить.</p>
    </div>
  );
}

// ─── table_fill (тип 16, §6.3 ТЗ, Э13 — достройка сверх стоп-листа Э8) ──

function TableFillEditor({
  interaction,
  onChange,
}: {
  interaction: Extract<QuestionInteraction, { type: "table_fill" }>;
  onChange: (interaction: QuestionInteraction) => void;
}) {
  function setCell(ri: number, ci: number, cell: (typeof interaction.rows)[number][number]) {
    onChange({
      ...interaction,
      rows: interaction.rows.map((row, r) => (r === ri ? row.map((c, c2) => (c2 === ci ? cell : c)) : row)),
    });
  }

  function toggleKind(ri: number, ci: number) {
    const cell = interaction.rows[ri]![ci]!;
    setCell(
      ri,
      ci,
      cell.kind === "static"
        ? {
            kind: "input",
            id: crypto.randomUUID(),
            answers: [{ value: "", match: "normalized" }],
            caseSensitive: false,
            trimWhitespace: true,
            typoTolerance: 0,
          }
        : { kind: "static", text: "" },
    );
  }

  function addRow() {
    const cols = interaction.rows[0]?.length ?? 1;
    onChange({
      ...interaction,
      rows: [...interaction.rows, Array.from({ length: cols }, () => ({ kind: "static" as const, text: "" }))],
    });
  }

  function removeRow(ri: number) {
    if (interaction.rows.length <= 1) return;
    onChange({ ...interaction, rows: interaction.rows.filter((_, r) => r !== ri) });
  }

  function addColumn() {
    onChange({ ...interaction, rows: interaction.rows.map((row) => [...row, { kind: "static" as const, text: "" }]) });
  }

  function removeColumn(ci: number) {
    if ((interaction.rows[0]?.length ?? 0) <= 1) return;
    onChange({ ...interaction, rows: interaction.rows.map((row) => row.filter((_, c) => c !== ci)) });
  }

  const cols = interaction.rows[0]?.length ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <tbody>
            {interaction.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className="border border-border p-1 align-top">
                    <div className="flex flex-col gap-0.5">
                      {cell.kind === "static" ? (
                        <input
                          value={cell.text}
                          onChange={(e) => setCell(ri, ci, { kind: "static", text: e.target.value })}
                          placeholder="текст"
                          className="w-24 rounded border border-transparent bg-transparent px-1 py-0.5 outline-none focus-visible:border-primary"
                        />
                      ) : (
                        <input
                          value={cell.answers[0]?.value ?? ""}
                          onChange={(e) =>
                            setCell(ri, ci, {
                              ...cell,
                              answers: [{ value: e.target.value, match: cell.answers[0]?.match ?? "normalized" }],
                            })
                          }
                          placeholder="правильный ответ"
                          className="w-24 rounded border border-primary/40 bg-primary-light/30 px-1 py-0.5 outline-none"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => toggleKind(ri, ci)}
                        className="text-left text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        {cell.kind === "static" ? "→ поле ответа" : "→ обычный текст"}
                      </button>
                    </div>
                  </td>
                ))}
                <td className="p-1 align-top">
                  <button
                    type="button"
                    onClick={() => removeRow(ri)}
                    disabled={interaction.rows.length <= 1}
                    aria-label="Удалить строку"
                    className="rounded-md border border-border p-1 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-30"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              {Array.from({ length: cols }, (_, ci) => (
                <td key={ci} className="p-1 text-center">
                  <button
                    type="button"
                    onClick={() => removeColumn(ci)}
                    disabled={cols <= 1}
                    aria-label="Удалить столбец"
                    className="rounded-md border border-border p-1 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-30"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
        >
          <Plus className="size-3" aria-hidden /> Строка
        </button>
        <button
          type="button"
          onClick={addColumn}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
        >
          <Plus className="size-3" aria-hidden /> Столбец
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Голубым — поля ответа (сравнение по нормализованному тексту, как в текстовом вопросе).
      </p>
    </div>
  );
}

// ─── ordering (Э9.6) — тот же приём, что `SortableOrderingItem` (плеер, Э8.5) и список блоков (редактор, Э9.3) ──

function OrderingEditor({
  interaction,
  onChange,
}: {
  interaction: Extract<QuestionInteraction, { type: "ordering" }>;
  onChange: (interaction: QuestionInteraction) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = interaction.items.map((i) => i.id);

  function setItems(items: IdHtmlItem[]) {
    onChange({ ...interaction, items });
  }

  function addItem() {
    setItems([...interaction.items, { id: crypto.randomUUID(), html: "" }]);
  }

  function removeItem(id: string) {
    if (interaction.items.length <= 2) return;
    setItems(interaction.items.filter((i) => i.id !== id));
  }

  function updateItem(id: string, html: string) {
    setItems(interaction.items.map((i) => (i.id === id ? { ...i, html } : i)));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= interaction.items.length) return;
    setItems(arrayMove(interaction.items, index, target));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    setItems(arrayMove(interaction.items, from, to));
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted-foreground">Порядок элементов ниже — и есть правильный порядок ответа.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-1.5">
            {interaction.items.map((item, i) => (
              <SortableOrderingEditorItem
                key={item.id}
                item={item}
                index={i}
                total={interaction.items.length}
                canRemove={interaction.items.length > 2}
                onChangeText={(html) => updateItem(item.id, html)}
                onMove={(direction) => move(i, direction)}
                onRemove={() => removeItem(item.id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <button type="button" onClick={addItem} className="self-start inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary">
        <Plus className="size-3" aria-hidden /> Добавить элемент
      </button>
    </div>
  );
}

function SortableOrderingEditorItem({
  item,
  index,
  total,
  canRemove,
  onChangeText,
  onMove,
  onRemove,
}: {
  item: IdHtmlItem;
  index: number;
  total: number;
  canRemove: boolean;
  onChangeText: (html: string) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1.5 ${isDragging ? "opacity-50" : ""}`}
    >
      <span {...attributes} {...listeners} className="flex cursor-grab select-none items-center px-1 text-muted-foreground" aria-hidden="true">
        <GripVertical className="size-4" />
      </span>
      <input
        value={item.html}
        onChange={(e) => onChangeText(e.target.value)}
        placeholder="Текст элемента"
        className="flex-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15"
      />
      <span className="flex flex-col">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          aria-label="Переместить выше"
          className="rounded border border-border p-0.5 text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-30"
        >
          <ChevronUp className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          disabled={index === total - 1}
          onClick={() => onMove(1)}
          aria-label="Переместить ниже"
          className="rounded border border-border p-0.5 text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-30"
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label="Удалить элемент"
        className="rounded-md border border-border p-1 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-30"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}
