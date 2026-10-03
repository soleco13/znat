import type {
  PublicQuestionInteraction,
  QuestionResponse,
} from "@school/shared";

import { sanitizeHtml } from "@/shared/sanitize-html";
import {
  CategorizePlayer,
  ClozeDropdownPlayer,
  ClozeTextPlayer,
  MatchingPlayer,
  OpenAnswerPlayer,
  OrderingPlayer,
} from "./AdvancedInteractionPlayers.js";

/**
 * Поля ответа заданий (Э8.4/8.5, §16 ТЗ: клавиатурная навигация во всех типах).
 * Принципиально — НАТИВНЫЕ элементы формы (radio/checkbox/text/number):
 * клавиатурная навигация и семантика для скринридеров бесплатно и корректно.
 * `interaction` уже очищен от ключа ответа (`PublicQuestionInteraction`).
 * Компоненты контролируемые (`value`/`onChange`), без собственного состояния.
 * Формулировку, баллы и подсказку рисует учебник (`textbook/TextbookTask`).
 */

/** Оформление полей — в textbook/textbook.css (.tb-opt, .tb-seg, .tb-input …).
 *  Контролы нативные, оформлены стилями: клавиатура и скринридеры работают сами. */

export function InteractionPlayer({
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
    <fieldset className="tb-tokens">
      <legend className="sr-only">Выделите нужные слова</legend>
      {tokens.map((t) => (
        <label key={t.id} className="tb-token">
          <input
            type="checkbox"
            checked={selected.has(t.id)}
            disabled={disabled}
            onChange={(e) => toggle(t.id, e.target.checked)}
          />
          <span
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
    <div className="tb-table-wrap">
      <table className="tb-fill">
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) =>
                cell.kind === "static" ? (
                  <td key={ci}>
                    <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(cell.text) }} />
                  </td>
                ) : (
                  <td key={ci} className="tb-fill-cell">
                    <label htmlFor={`tf-${cell.id}`} className="sr-only">
                      Ячейка {ri + 1}-{ci + 1}
                    </label>
                    <input
                      id={`tf-${cell.id}`}
                      type="text"
                      className="tb-fill-input"
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
    <fieldset className="tb-options">
      <legend className="sr-only">Выберите один вариант ответа</legend>
      {options.map((option) => (
        <label key={option.id} className="tb-opt">
          <input
            type="radio"
            name={`q-${questionId}`}
            value={option.id}
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
    <fieldset className="tb-options">
      <legend className="sr-only">Выберите один или несколько вариантов ответа</legend>
      {options.map((option) => (
        <label key={option.id} className="tb-opt">
          <input
            type="checkbox"
            id={`q-${questionId}-${option.id}`}
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
    <fieldset className="tb-seg">
      <legend className="sr-only">Верно или неверно</legend>
      <label>
        <input
          type="radio"
          name={`q-${questionId}`}
          checked={value?.value === true}
          disabled={disabled}
          onChange={() => onChange({ type: "true_false", value: true })}
        />
        Верно
      </label>
      <label>
        <input
          type="radio"
          name={`q-${questionId}`}
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
      <input
        id={inputId}
        type="text"
        className="tb-input"
        placeholder="Ваш ответ"
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
    <div className="tb-input-row">
      <label htmlFor={valueInputId} className="sr-only">
        Числовой ответ
      </label>
      <input
        id={valueInputId}
        type="number"
        step="any"
        inputMode="decimal"
        placeholder="число"
        className="tb-input tb-input--num"
        value={value?.value ?? ""}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      />
      {unitRequired && (
        <>
          <label htmlFor={unitInputId} className="tb-input-hint">
            Единица измерения{unit ? ` (например, ${unit})` : ""}
          </label>
          <input
            id={unitInputId}
            type="text"
            className="tb-input tb-input--num"
            value={value?.unit ?? ""}
            disabled={disabled}
            onChange={(e) => setUnit(e.target.value)}
          />
        </>
      )}
    </div>
  );
}
