import {
  BookMarked,
  Calculator,
  FileText,
  ListChecks,
  Quote,
  Sigma,
  SpellCheck2,
  SquareCheckBig,
  type LucideIcon,
} from "lucide-react";
import type {
  Material,
  MaterialBlock,
  MaterialBlockGroup,
  QuestionInteraction,
} from "@school/shared";
import { createContentBlock, createQuestionBlock } from "./block-factories.js";

/**
 * Конструкции материала (Э13, §7.1 ТЗ п.5: «методист не начинает с чистого
 * листа»). Два вида:
 *
 * - `kind: "group"` — многоблочный каркас (разбор задачи, блок проверки,
 *   диктант). При вставке блоки оборачиваются в редакторе в визуальную
 *   рамку-группу (`MaterialBlockGroup`), чтобы методист видел их
 *   происхождение и мог свернуть/разгруппировать. В JSON материала группа
 *   — просто метка (`material.groups`), плеер её игнорирует.
 * - `kind: "block"` — один преднастроенный блок (врезка «Определение»,
 *   вопрос с 4 вариантами). Группа не создаётся.
 *
 * Строятся ТЕМИ ЖЕ фабриками, что кнопка «+» в редакторе
 * (`block-factories.ts`) — конструкция не может собрать блок в форме,
 * недостижимой обычным редактированием. Заполнены только структурой и
 * заготовками-подписями: реальный текст методист приносит сам. Где
 * заготовка не может быть валидной без содержимого (слово в диктанте,
 * вариант ответа) — валидатор честно продолжит подсвечивать блок, пока
 * его не доредактируют.
 */
export interface MaterialConstruct {
  id: string;
  kind: "group" | "block";
  label: string;
  description: string;
  icon: LucideIcon;
  /** Короткая схема состава — чипы на карточке пикера. */
  outline: string[];
  build: () => MaterialBlock[];
}

function richText(html: string): MaterialBlock {
  const block = createContentBlock("rich_text", crypto.randomUUID());
  if (block.type === "rich_text") block.html = html;
  return block;
}

function callout(variant: "note" | "warning" | "example", html: string): MaterialBlock {
  const block = createContentBlock("callout", crypto.randomUUID());
  if (block.type === "callout") {
    block.variant = variant;
    block.html = html;
  }
  return block;
}

function formula(latex: string): MaterialBlock {
  const block = createContentBlock("formula", crypto.randomUUID());
  if (block.type === "formula") block.latex = latex;
  return block;
}

function question(
  interactionType: QuestionInteraction["type"],
  promptHtml: string,
  points = 1,
): MaterialBlock {
  const block = createQuestionBlock(interactionType, crypto.randomUUID());
  block.prompt = { html: promptHtml };
  block.points = points;
  return block;
}

function mcQuestion(promptHtml: string, options: string[], correctIndex: number): MaterialBlock {
  const block = createQuestionBlock("single_choice", crypto.randomUUID());
  block.prompt = { html: promptHtml };
  block.points = 1;
  block.interaction = {
    type: "single_choice",
    shuffle: false,
    options: options.map((html, i) => ({
      id: crypto.randomUUID(),
      html: `<p>${html}</p>`,
      correct: i === correctIndex,
    })),
  };
  return block;
}

export const MATERIAL_CONSTRUCTS: MaterialConstruct[] = [
  // ─── Многоблочные каркасы ────────────────────────────────────────────────
  {
    id: "problem_walkthrough",
    kind: "group",
    label: "Разбор задачи",
    description: "Условие, формула, пошаговое решение и вопрос с числовым ответом.",
    icon: Calculator,
    outline: ["Условие", "Формула", "Шаг 1", "Шаг 2", "Числовой вопрос"],
    build: () => [
      richText("<h2>Разбор задачи</h2><p>Условие задачи.</p>"),
      formula("x"),
      callout("example", "<p><strong>Шаг 1.</strong> </p>"),
      callout("example", "<p><strong>Шаг 2.</strong> </p>"),
      question("numeric_input", "<p>Чему равен ответ?</p>"),
    ],
  },
  {
    id: "quiz_block",
    kind: "group",
    label: "Блок проверки",
    description: "Короткая инструкция и три вопроса с одним правильным ответом.",
    icon: ListChecks,
    outline: ["Инструкция", "Вопрос 1", "Вопрос 2", "Вопрос 3"],
    build: () => [
      richText("<p>Ответьте на вопросы ниже.</p>"),
      question("single_choice", "<p>Вопрос 1</p>"),
      question("single_choice", "<p>Вопрос 2</p>"),
      question("single_choice", "<p>Вопрос 3</p>"),
    ],
  },
  {
    id: "spelling_dictation",
    kind: "group",
    label: "Словарный диктант",
    description: "Вступление и пять текстовых вопросов — по одному на слово.",
    icon: SpellCheck2,
    outline: ["Вступление", "5 × слово"],
    build: () => [
      richText("<p>Учитель диктует слово — впишите его без ошибок.</p>"),
      ...Array.from({ length: 5 }, (_, i) => question("text_input", `<p>Слово ${i + 1}</p>`)),
    ],
  },
  {
    id: "definition_block",
    kind: "group",
    label: "Определение и теорема",
    description: "Три врезки: определение, теорема, пример применения.",
    icon: BookMarked,
    outline: ["Определение", "Теорема", "Пример"],
    build: () => [
      callout("note", "<p><strong>Определение.</strong> </p>"),
      callout("warning", "<p><strong>Теорема.</strong> </p>"),
      callout("example", "<p><strong>Пример.</strong> </p>"),
    ],
  },
  {
    id: "paragraph_with_check",
    kind: "group",
    label: "Параграф с проверкой",
    description: "Подзаголовок и текст параграфа, затем два вопроса на понимание.",
    icon: FileText,
    outline: ["Текст параграфа", "Вопрос-выбор", "Верно/неверно"],
    build: () => [
      richText("<h2>Название параграфа</h2><p>Текст параграфа.</p>"),
      question("single_choice", "<p>Вопрос по тексту</p>"),
      question("true_false", "<p>Утверждение — верно или неверно?</p>"),
    ],
  },
  // ─── Готовые одиночные блоки ─────────────────────────────────────────────
  {
    id: "definition_callout",
    kind: "block",
    label: "Врезка «Определение»",
    description: "Синяя врезка с заголовком «Определение».",
    icon: Quote,
    outline: ["Врезка · заметка"],
    build: () => [callout("note", "<p><strong>Определение.</strong> </p>")],
  },
  {
    id: "theorem_callout",
    kind: "block",
    label: "Врезка «Теорема»",
    description: "Врезка-предупреждение с заголовком «Теорема».",
    icon: Quote,
    outline: ["Врезка · внимание"],
    build: () => [callout("warning", "<p><strong>Теорема.</strong> </p>")],
  },
  {
    id: "example_callout",
    kind: "block",
    label: "Врезка «Пример»",
    description: "Врезка с разобранным примером.",
    icon: Quote,
    outline: ["Врезка · пример"],
    build: () => [callout("example", "<p><strong>Пример.</strong> </p>")],
  },
  {
    id: "mc4",
    kind: "block",
    label: "Вопрос: выбор из 4",
    description: "Вопрос с одним правильным ответом и четырьмя вариантами.",
    icon: SquareCheckBig,
    outline: ["Один ответ · 4 варианта"],
    build: () => [
      mcQuestion("<p>Формулировка вопроса</p>", ["Вариант 1", "Вариант 2", "Вариант 3", "Вариант 4"], 0),
    ],
  },
  {
    id: "numeric_tolerance",
    kind: "block",
    label: "Числовой ответ с допуском",
    description: "Числовой вопрос с относительным допуском 1 %.",
    icon: Sigma,
    outline: ["Число · допуск ±1 %"],
    build: () => {
      const block = createQuestionBlock("numeric_input", crypto.randomUUID());
      block.prompt = { html: "<p>Вычислите значение</p>" };
      block.interaction = {
        type: "numeric_input",
        value: 0,
        tolerance: { kind: "relative", value: 0.01 },
        unitRequired: false,
      };
      return [block];
    },
  },
];

export function findConstruct(id: string): MaterialConstruct | undefined {
  return MATERIAL_CONSTRUCTS.find((c) => c.id === id);
}

/**
 * Разворачивает конструкцию в блоки + (для многоблочных) редакторскую
 * группу, связывающую их по id. Для `kind: "block"` группа не нужна —
 * `group: null`.
 */
export function instantiateConstruct(construct: MaterialConstruct): {
  blocks: MaterialBlock[];
  group: MaterialBlockGroup | null;
} {
  const blocks = construct.build();
  if (construct.kind === "block" || blocks.length < 2) {
    return { blocks, group: null };
  }
  return {
    blocks,
    group: {
      id: crypto.randomUUID(),
      templateId: construct.id,
      label: construct.label,
      blockIds: blocks.map((b) => b.id),
    },
  };
}

/** Пустой валидный `Material` для мгновенного создания черновика (Э13, вкладка «Редактор»). */
export function buildBlankMaterial(meta: {
  title: string;
  subject: string;
  grades: number[];
  topic?: string;
}): Material {
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    title: meta.title,
    subject: meta.subject,
    grades: meta.grades,
    topic: meta.topic?.trim() || undefined,
    tags: [],
    settings: { shuffleBlocks: false, showFeedback: "after_submit", attemptsAllowed: 1 },
    blocks: [],
    groups: [],
  };
}
