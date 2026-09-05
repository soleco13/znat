import type { Material, MaterialBlock, QuestionInteraction } from "@school/shared";
import { createBlock, createQuestionBlock } from "./block-factories.js";

/**
 * Шаблоны материалов (Э9.10, §7.1 ТЗ п.5: «методист не начинает с чистого
 * листа») — три именованных набора блоков + «пустой» (тот же результат,
 * что «Создать материал» без выбора шаблона давал бы и без этого файла).
 * Строятся ТЕМИ ЖЕ фабриками блоков, что кнопка «Добавить блок» в
 * редакторе (`block-factories.ts`, вынесены туда для Э9.10) — шаблон не
 * может допустить блок в форме, недостижимой обычным редактированием.
 *
 * Заполнены ТОЛЬКО структурой и общими подписями («Вопрос 1», «Шаг 1») —
 * не выдуманным содержимым конкретного предмета: методист приносит
 * реальный текст вопросов/слов сам, шаблон экономит именно расстановку
 * блоков и типов вопросов, а не думает за него. Где это осмысленно
 * дёшево (single_choice/numeric_input) — заготовка уже проходит
 * валидатор (Э9.9, `validateMaterialContent`) без правок; там, где
 * содержимого угадать нельзя (`text_input` в диктанте — реальное слово),
 * валидатор намеренно продолжит показывать «нет правильного ответа»,
 * пока методист не впишет настоящие слова — это не баг шаблона, а
 * честное отражение того, что реально нужно доделать руками.
 */
export interface MaterialTemplate {
  id: string;
  label: string;
  description: string;
  buildBlocks: () => MaterialBlock[];
}

function questionWithPrompt(interactionType: QuestionInteraction["type"], promptHtml: string, points = 1) {
  const block = createQuestionBlock(interactionType, crypto.randomUUID());
  block.prompt = { html: promptHtml };
  block.points = points;
  return block;
}

export const MATERIAL_TEMPLATES: MaterialTemplate[] = [
  {
    id: "blank",
    label: "Пустой материал",
    description: "Начать с чистого листа — блоки добавляются в редакторе по одному.",
    buildBlocks: () => [],
  },
  {
    id: "quiz10",
    label: "Проверочная на 10 вопросов",
    description: "Вступление + 10 вопросов с одним правильным ответом — замените текст вопросов и вариантов на свои.",
    buildBlocks: () => {
      const intro = createBlock("rich_text");
      if (intro.type === "rich_text") intro.html = "<p>Ответьте на все вопросы ниже.</p>";
      const questions = Array.from({ length: 10 }, (_, i) =>
        questionWithPrompt("single_choice", `<p>Вопрос ${i + 1}</p>`),
      );
      return [intro, ...questions];
    },
  },
  {
    id: "problem_walkthrough",
    label: "Разбор задачи",
    description: "Условие → формула → шаги решения → вопрос с числовым ответом.",
    buildBlocks: () => {
      const statement = createBlock("rich_text");
      if (statement.type === "rich_text") statement.html = "<p>Условие задачи.</p>";
      const formula = createBlock("formula");
      if (formula.type === "formula") formula.latex = "x";
      const step1 = createBlock("callout");
      if (step1.type === "callout") {
        step1.variant = "example";
        step1.html = "<p>Шаг 1.</p>";
      }
      const step2 = createBlock("callout");
      if (step2.type === "callout") {
        step2.variant = "example";
        step2.html = "<p>Шаг 2.</p>";
      }
      const answer = questionWithPrompt("numeric_input", "<p>Чему равен ответ?</p>");
      return [statement, formula, step1, step2, answer];
    },
  },
  {
    id: "spelling_dictation",
    label: "Словарный диктант",
    description: "Вступление + 10 текстовых вопросов, по одному на слово — впишите настоящие слова и правильные ответы.",
    buildBlocks: () => {
      const intro = createBlock("rich_text");
      if (intro.type === "rich_text") intro.html = "<p>Учитель диктует слово — впишите его без ошибок.</p>";
      const words = Array.from({ length: 10 }, (_, i) => questionWithPrompt("text_input", `<p>Слово ${i + 1}</p>`));
      return [intro, ...words];
    },
  },
];

/** Собирает полноценный `Material` (готовый к `POST /materials`) из метаданных формы + блоков выбранного шаблона. */
export function buildMaterialFromTemplate(
  template: MaterialTemplate,
  meta: { title: string; subject: string; grades: number[]; topic?: string },
): Material {
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    title: meta.title,
    subject: meta.subject,
    grades: meta.grades,
    // `topic` в схеме — `min(1).optional()`, пустая строка из формы не пройдёт как валидное значение.
    topic: meta.topic?.trim() || undefined,
    tags: [],
    settings: { shuffleBlocks: false, showFeedback: "after_submit", attemptsAllowed: 1 },
    blocks: template.buildBlocks(),
  };
}
