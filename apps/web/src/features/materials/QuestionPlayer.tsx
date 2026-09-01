import type { PublicQuestionBlock, PublicQuestionInteraction, QuestionResponse } from "@school/shared";
import {
  ClozeDropdownPlayer,
  ClozeTextPlayer,
  MatchingPlayer,
  OpenAnswerPlayer,
  OrderingPlayer,
} from "./AdvancedInteractionPlayers.js";
import { sanitizeHtml } from "../../shared/sanitize-html.js";

/**
 * Плеер заданий (Э8.4/8.5, §16 ТЗ: «клавиатурная навигация во всех типах
 * заданий»). Типы 1–5 (`single_choice`, `multiple_choice`, `true_false`,
 * `text_input`, `numeric_input`) — здесь; 6–10 (`open_answer`,
 * `cloze_dropdown`, `cloze_text`, `matching`, `ordering`, Э8.5) —
 * `AdvancedInteractionPlayers.tsx` (drag-and-drop через `dnd-kit`),
 * подключены в тот же диспетчер ниже.
 *
 * Принципиально — НАТИВНЫЕ элементы формы (`input[type=radio/checkbox/
 * text/number]` в `<label>`), а не кастомные `<div onClick>`: радио/чекбоксы
 * получают клавиатурную навигацию (Tab, стрелки внутри группы, Space) от
 * браузера бесплатно и корректно для скринридеров — переизобретать это
 * вручную было бы источником багов доступности на пустом месте, которые
 * `Playwright MCP` (accessibility-снимки, не скриншоты, см. ПЛАН.md Э8)
 * либо не поймает, либо поймает поздно.
 *
 * `interaction` — уже ОЧИЩЕННЫЙ от ключа ответа (`PublicQuestionInteraction`,
 * `stripInteractionAnswerKey`, Э8.1) — этот компонент физически не может
 * получить правильный ответ, даже по ошибке: секретных полей в типе просто
 * нет. Сервер (Э8.6, ещё не сделан) отдаёт материал только в этом виде.
 *
 * Компонент — контролируемый (`value`/`onChange`), без собственного
 * состояния ответа: хранение (автосохранение, Э8.7) и синхронизация
 * между вопросами материала — забота вызывающей стороны (плеер материала
 * целиком, ещё не сделан).
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
    <div className="rounded border p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        {/* HTML из материала (§6 ТЗ) — санитайзируется (`sanitize-html.ts`), не рендерится сырым: до Э9 материалы заводятся JSON-ом через seed-скрипт/Postman, без гарантии происхождения. */}
        <div className="text-sm" dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.prompt.html) }} />
        <span className="shrink-0 text-xs text-slate-400">
          {block.points} {pointsLabel(block.points)}
        </span>
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
  // Достаточно грубо для 1..4 (типичные баллы задания) — не полноценная плюрализация рус. числительных.
  if (points === 1) return "балл";
  if (points >= 2 && points <= 4) return "балла";
  return "баллов";
}

/** `<details>` — раскрытие подсказки нативно доступно с клавиатуры (Enter/Space на `<summary>`), без своего JS-обработчика. */
function HintDisclosure({ html }: { html: string }) {
  return (
    <details className="mb-2 text-xs text-slate-500">
      <summary className="cursor-pointer">Подсказка</summary>
      <div className="mt-1" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
    </details>
  );
}

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
  }
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
    <fieldset className="flex flex-col gap-1">
      <legend className="sr-only">Выберите один вариант ответа</legend>
      {options.map((option) => (
        <label key={option.id} className="flex items-center gap-2 text-sm">
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
    <fieldset className="flex flex-col gap-1">
      <legend className="sr-only">Выберите один или несколько вариантов ответа</legend>
      {options.map((option) => (
        <label key={option.id} className="flex items-center gap-2 text-sm">
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
    <fieldset className="flex gap-4">
      <legend className="sr-only">Верно или неверно</legend>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name={`q-${questionId}`}
          checked={value?.value === true}
          disabled={disabled}
          onChange={() => onChange({ type: "true_false", value: true })}
        />
        Верно
      </label>
      <label className="flex items-center gap-2 text-sm">
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
        className="w-full rounded border px-2 py-1 text-sm"
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
    <div className="flex items-center gap-2">
      <label htmlFor={valueInputId} className="sr-only">
        Числовой ответ
      </label>
      <input
        id={valueInputId}
        type="number"
        step="any"
        className="w-32 rounded border px-2 py-1 text-sm"
        value={value?.value ?? ""}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      />
      {unitRequired && (
        <>
          <label htmlFor={unitInputId} className="text-xs text-slate-500">
            Единица измерения{unit ? ` (например, ${unit})` : ""}
          </label>
          <input
            id={unitInputId}
            type="text"
            className="w-24 rounded border px-2 py-1 text-sm"
            value={value?.unit ?? ""}
            disabled={disabled}
            onChange={(e) => setUnit(e.target.value)}
          />
        </>
      )}
    </div>
  );
}
