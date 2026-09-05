import type { ContentBlock, MaterialBlock, QuestionBlock, QuestionInteraction } from "@school/shared";

/**
 * Фабрики пустых блоков/интеракций — вынесены из `MaterialEditorPage.tsx`
 * (Э9.2, «Добавить блок») в отдельный модуль, чтобы Э9.10 (шаблоны
 * материалов, `material-templates.ts`) могла строить блоки С РЕАЛЬНЫМ
 * содержимым той же самой функцией, что и «пустая» кнопка добавления в
 * редакторе — один источник правды за формой блока каждого типа, не два
 * похожих места, которые могут разъехаться при добавлении 11-го типа.
 */
export const CONTENT_BLOCK_LABELS: Record<ContentBlock["type"], string> = {
  rich_text: "Текст",
  image: "Изображение",
  video: "Видео",
  audio: "Аудио",
  formula: "Формула",
  table: "Таблица",
  callout: "Врезка",
  embed: "Встраивание",
  page_break: "Разрыв страницы",
};

export const INTERACTION_LABELS: Record<QuestionInteraction["type"], string> = {
  single_choice: "Один правильный ответ",
  multiple_choice: "Несколько правильных ответов",
  true_false: "Верно/неверно",
  text_input: "Текстовый ответ",
  numeric_input: "Числовой ответ",
  open_answer: "Развёрнутый ответ",
  cloze_dropdown: "Пропуски — выбор из списка",
  cloze_text: "Пропуски — ввод текста",
  matching: "Сопоставление",
  ordering: "Упорядочивание",
};

export function createBlock(key: ContentBlock["type"] | QuestionInteraction["type"]): MaterialBlock {
  const id = crypto.randomUUID();
  if (key in CONTENT_BLOCK_LABELS) return createContentBlock(key as ContentBlock["type"], id);
  return createQuestionBlock(key as QuestionInteraction["type"], id);
}

export function createContentBlock(type: ContentBlock["type"], id: string): ContentBlock {
  switch (type) {
    case "rich_text":
      return { type, id, html: "" };
    case "image":
      return { type, id, assetId: "", zoomable: false };
    case "video":
      return { type, id, assetId: "" };
    case "audio":
      return { type, id, assetId: "" };
    case "formula":
      return { type, id, latex: "" };
    case "table":
      return { type, id, rows: [["", ""]] };
    case "callout":
      return { type, id, variant: "note", html: "" };
    case "embed":
      return { type, id, provider: "geogebra", config: {} };
    case "page_break":
      return { type, id };
  }
}

export function createQuestionBlock(interactionType: QuestionInteraction["type"], id: string): QuestionBlock {
  return {
    type: "question",
    id,
    prompt: { html: "" },
    points: 1,
    interaction: createInteraction(interactionType),
  };
}

export function createInteraction(type: QuestionInteraction["type"]): QuestionInteraction {
  switch (type) {
    case "single_choice":
    case "multiple_choice":
      return {
        type,
        shuffle: false,
        options: [
          { id: crypto.randomUUID(), html: "", correct: type === "single_choice" },
          { id: crypto.randomUUID(), html: "", correct: false },
        ],
      };
    case "true_false":
      return { type, correct: true };
    case "text_input":
      return {
        type,
        answers: [{ value: "", match: "exact" }],
        caseSensitive: false,
        trimWhitespace: true,
        typoTolerance: 0,
      };
    case "numeric_input":
      return { type, value: 0, tolerance: { kind: "absolute", value: 0 }, unitRequired: false };
    case "open_answer":
      return {
        type,
        maxLength: 500,
        allowAttachments: false,
        rubric: [{ id: crypto.randomUUID(), label: "", points: 1 }],
      };
    case "cloze_dropdown":
      return { type, template: "", gaps: {} };
    case "cloze_text":
      return { type, template: "", gaps: {} };
    case "matching": {
      // Свежая пара left[0]/right[0] сразу связана друг с другом (Э9.10,
      // обнаружено при написании шаблонов) — раньше здесь было `pairs: []`,
      // а `matchingInteractionSchema.pairs` в схеме `.min(1)`: только что
      // добавленный через «Добавить блок» matching-вопрос был структурно
      // НЕВАЛИДНЫМ материалом до первой ручной правки пары в
      // `MatchingEditor` (Э9.6) — ближайшее автосохранение (`PUT
      // /materials/:id`, `materialSchema.parse` на сервере) отклонило бы
      // ВЕСЬ материал целиком с 400, включая не относящиеся к matching
      // изменения в других блоках, молча забуксовав автосохранение до
      // починки. Пара по умолчанию — та же гарантия, что уже даёт
      // `ordering` (валиден с двумя элементами сразу).
      const leftId = crypto.randomUUID();
      const rightId = crypto.randomUUID();
      return {
        type,
        left: [{ id: leftId, html: "" }],
        right: [{ id: rightId, html: "" }],
        pairs: [[leftId, rightId]],
        scoring: "all_or_nothing",
        distractors: [],
      };
    }
    case "ordering":
      return {
        type,
        items: [
          { id: crypto.randomUUID(), html: "" },
          { id: crypto.randomUUID(), html: "" },
        ],
      };
  }
}
