import type {
  PublicQuestionBlock,
  PublicQuestionInteraction,
  QuestionResponse,
} from "@school/shared";

import { sanitizeHtml } from "@/shared/sanitize-html";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import {
  CategorizePlayer,
  ClozeDropdownPlayer,
  ClozeTextPlayer,
  MatchingPlayer,
  OpenAnswerPlayer,
  OrderingPlayer,
} from "./AdvancedInteractionPlayers.js";

/**
 * Плеер заданий (Э8.4/8.5, §16 ТЗ: клавиатурная навигация во всех типах).
 * Принципиально — НАТИВНЫЕ элементы формы (radio/checkbox/text/number):
 * клавиатурная навигация и семантика для скринридеров бесплатно и корректно.
 * `interaction` уже очищен от ключа ответа (`PublicQuestionInteraction`).
 * Компонент контролируемый (`value`/`onChange`), без собственного состояния.
 */
export function QuestionPlayer({
  block,
  value,
  onChange,
  disabled = false,
}: {
  block: PublicQuestionBlock;
  value: QuestionResponse | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div
          className="prose text-sm"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.prompt.html) }}
        />
        <Badge variant="muted" className="shrink-0">
          {block.points} {pointsLabel(block.points)}
        </Badge>
      </div>
      {block.hint && <HintDisclosure html={block.hint.html} />}
      <div className="mt-3">
        <InteractionPlayer
          questionId={block.id}
          interaction={block.interaction}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function pointsLabel(points: number): string {
  if (points === 1) return "балл";
  if (points >= 2 && points <= 4) return "балла";
  return "баллов";
}

function HintDisclosure({ html }: { html: string }) {
  return (
    <details className="mb-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium">Подсказка</summary>
      <div className="prose mt-1" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
    </details>
  );
}

/** Общий класс для строки-варианта с нативным input внутри. */
const OPTION_ROW =
  "flex cursor-pointer items-center gap-2.5 rounded-md border border-transparent px-2 py-1.5 text-sm transition-colors hover:bg-secondary has-[:checked]:border-primary/40 has-[:checked]:bg-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60";
const NATIVE_CONTROL = "size-4 shrink-0 accent-[hsl(var(--primary))]";

function InteractionPlayer({
  questionId,
  interaction,
  value,
  onChange,
  disabled,
}: {
  questionId: string;
  interaction: PublicQuestionInteraction;
  value: QuestionResponse | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled: boolean;
}) {
  switch (interaction.type) {
    case "single_choice":
      return (
        <SingleChoicePlayer
          questionId={questionId}
          options={interaction.options}
          value={value?.type === "single_choice" ? value : undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "multiple_choice":
      return (
        <MultipleChoicePlayer
          questionId={questionId}
          options={interaction.options}
          value={value?.type === "multiple_choice" ? value : undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "true_false":
      return (
        <TrueFalsePlayer
          questionId={questionId}
          value={value?.type === "true_false" ? value : undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "text_input":
      return (
        <TextInputPlayer
          questionId={questionId}
          value={value?.type === "text_input" ? value : undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "numeric_input":
      return (
        <NumericInputPlayer
          questionId={questionId}
          unit={interaction.unit}
          unitRequired={interaction.unitRequired}
          value={value?.type === "numeric_input" ? value : undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "open_answer":
      return (
        <OpenAnswerPlayer
          questionId={questionId}
          maxLength={interaction.maxLength}
          value={value?.type === "open_answer" ? value : undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "cloze_dropdown":
      return (
        <ClozeDropdownPlayer
          questionId={questionId}
          template={interaction.template}
          gaps={interaction.gaps}
          value={value?.type === "cloze_dropdown" ? value : undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "cloze_text":
      return (
        <ClozeTextPlayer
          template={interaction.template}
          gapIds={interaction.gapIds}
          value={value?.type === "cloze_text" ? value : undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "matching":
      return (
        <MatchingPlayer
          left={interaction.left}
          right={interaction.right}
          value={value?.type === "matching" ? value : undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "ordering":
      return (
        <OrderingPlayer
          items={interaction.items}
          value={value?.type === "ordering" ? value : undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "categorize":
      return (
        <CategorizePlayer
          categories={interaction.categories}
          items={interaction.items}
          value={value?.type === "categorize" ? value : undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "highlight_text":
      return (
        <HighlightTextPlayer
          tokens={interaction.tokens}
          value={value?.type === "highlight_text" ? value : undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "table_fill":
      return (
        <TableFillPlayer
          rows={interaction.rows}
          value={value?.type === "table_fill" ? value : undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
  }
}

function HighlightTextPlayer({
  tokens,
  value,
  onChange,
  disabled,
}: {
  tokens: { id: string; text: string }[];
  value: Extract<QuestionResponse, { type: "highlight_text" }> | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled: boolean;
}) {
  const selected = new Set(value?.selectedIds ?? []);

  function toggle(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onChange({ type: "highlight_text", selectedIds: [...next] });
  }

  return (
    <fieldset className="flex flex-wrap gap-x-1 gap-y-1.5 text-sm leading-8">
      <legend className="sr-only">Выделите нужные слова</legend>
      {tokens.map((t) => (
        <label key={t.id} className="cursor-pointer">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={selected.has(t.id)}
            disabled={disabled}
            onChange={(e) => toggle(t.id, e.target.checked)}
          />
          <span
            className="rounded px-1.5 py-0.5 transition-colors hover:bg-secondary peer-checked:bg-primary/20 peer-checked:text-primary peer-checked:underline peer-checked:decoration-2 peer-checked:underline-offset-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-60"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(t.text) }}
          />
        </label>
      ))}
    </fieldset>
  );
}

function TableFillPlayer({
  rows,
  value,
  onChange,
  disabled,
}: {
  rows: (
    | { kind: "static"; text: string }
    | { kind: "input"; id: string }
  )[][];
  value: Extract<QuestionResponse, { type: "table_fill" }> | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled: boolean;
}) {
  const values = value?.values ?? {};

  function setValue(id: string, v: string) {
    onChange({ type: "table_fill", values: { ...values, [id]: v } });
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) =>
                cell.kind === "static" ? (
                  <td key={ci} className="border border-border px-2 py-1">
                    <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(cell.text) }} />
                  </td>
                ) : (
                  <td key={ci} className="border border-border px-2 py-1">
                    <label htmlFor={`tf-${cell.id}`} className="sr-only">
                      Ячейка {ri + 1}-{ci + 1}
                    </label>
                    <Input
                      id={`tf-${cell.id}`}
                      type="text"
                      className="h-7 w-28"
                      value={values[cell.id] ?? ""}
                      disabled={disabled}
                      onChange={(e) => setValue(cell.id, e.target.value)}
                    />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SingleChoicePlayer({
  questionId,
  options,
  value,
  onChange,
  disabled,
}: {
  questionId: string;
  options: { id: string; html: string }[];
  value: Extract<QuestionResponse, { type: "single_choice" }> | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-0.5">
      <legend className="sr-only">Выберите один вариант ответа</legend>
      {options.map((option) => (
        <label key={option.id} className={OPTION_ROW}>
          <input
            type="radio"
            name={`q-${questionId}`}
            value={option.id}
            className={NATIVE_CONTROL}
            checked={value?.selectedOptionId === option.id}
            disabled={disabled}
            onChange={() => onChange({ type: "single_choice", selectedOptionId: option.id })}
          />
          <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(option.html) }} />
        </label>
      ))}
    </fieldset>
  );
}

function MultipleChoicePlayer({
  questionId,
  options,
  value,
  onChange,
  disabled,
}: {
  questionId: string;
  options: { id: string; html: string }[];
  value: Extract<QuestionResponse, { type: "multiple_choice" }> | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled: boolean;
}) {
  const selected = new Set(value?.selectedOptionIds ?? []);

  function toggle(optionId: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(optionId);
    else next.delete(optionId);
    onChange({ type: "multiple_choice", selectedOptionIds: [...next] });
  }

  return (
    <fieldset className="flex flex-col gap-0.5">
      <legend className="sr-only">Выберите один или несколько вариантов ответа</legend>
      {options.map((option) => (
        <label key={option.id} className={OPTION_ROW}>
          <input
            type="checkbox"
            id={`q-${questionId}-${option.id}`}
            className={`${NATIVE_CONTROL} rounded`}
            checked={selected.has(option.id)}
            disabled={disabled}
            onChange={(e) => toggle(option.id, e.target.checked)}
          />
          <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(option.html) }} />
        </label>
      ))}
    </fieldset>
  );
}

function TrueFalsePlayer({
  questionId,
  value,
  onChange,
  disabled,
}: {
  questionId: string;
  value: Extract<QuestionResponse, { type: "true_false" }> | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="flex gap-2">
      <legend className="sr-only">Верно или неверно</legend>
      <label className={OPTION_ROW}>
        <input
          type="radio"
          name={`q-${questionId}`}
          className={NATIVE_CONTROL}
          checked={value?.value === true}
          disabled={disabled}
          onChange={() => onChange({ type: "true_false", value: true })}
        />
        Верно
      </label>
      <label className={OPTION_ROW}>
        <input
          type="radio"
          name={`q-${questionId}`}
          className={NATIVE_CONTROL}
          checked={value?.value === false}
          disabled={disabled}
          onChange={() => onChange({ type: "true_false", value: false })}
        />
        Неверно
      </label>
    </fieldset>
  );
}

function TextInputPlayer({
  questionId,
  value,
  onChange,
  disabled,
}: {
  questionId: string;
  value: Extract<QuestionResponse, { type: "text_input" }> | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled: boolean;
}) {
  const inputId = `q-${questionId}-text`;
  return (
    <div>
      <label htmlFor={inputId} className="sr-only">
        Ваш ответ
      </label>
      <Input
        id={inputId}
        type="text"
        value={value?.value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ type: "text_input", value: e.target.value })}
      />
    </div>
  );
}

function NumericInputPlayer({
  questionId,
  unit,
  unitRequired,
  value,
  onChange,
  disabled,
}: {
  questionId: string;
  unit: string | undefined;
  unitRequired: boolean;
  value: Extract<QuestionResponse, { type: "numeric_input" }> | undefined;
  onChange: (response: QuestionResponse) => void;
  disabled: boolean;
}) {
  const valueInputId = `q-${questionId}-value`;
  const unitInputId = `q-${questionId}-unit`;

  function setValue(raw: string) {
    const parsed = raw.trim() === "" ? null : Number(raw);
    onChange({
      type: "numeric_input",
      value: parsed !== null && Number.isFinite(parsed) ? parsed : null,
      unit: value?.unit,
    });
  }

  function setUnit(raw: string) {
    onChange({ type: "numeric_input", value: value?.value ?? null, unit: raw });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={valueInputId} className="sr-only">
        Числовой ответ
      </label>
      <Input
        id={valueInputId}
        type="number"
        step="any"
        className="w-32"
        value={value?.value ?? ""}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      />
      {unitRequired && (
        <>
          <label htmlFor={unitInputId} className="text-xs text-muted-foreground">
            Единица измерения{unit ? ` (например, ${unit})` : ""}
          </label>
          <Input
            id={unitInputId}
            type="text"
            className="w-24"
            value={value?.unit ?? ""}
            disabled={disabled}
            onChange={(e) => setUnit(e.target.value)}
          />
        </>
      )}
    </div>
  );
}
