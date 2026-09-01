import { z } from "zod";

/**
 * Формат интерактивных материалов (Э8.1, §6 ТЗ). Материал — версионируемый
 * JSON-документ (`materials`/`material_versions`, Э8.2, ещё не сделаны) —
 * линейный список блоков: контентные (§6.2) и вопросы (§6.3). Схемы здесь —
 * контракт, единый для фронта (плеер, Э8.4/8.5) и бэка (движок проверки,
 * Э8.3) — «сначала схемы, потом всё остальное» (§ «Как работать» CLAUDE.md).
 *
 * MVP-приоритет — ровно 10 типов взаимодействия (★ в таблице §6.3 ТЗ), не
 * все 22: `single_choice`, `multiple_choice`, `true_false`, `text_input`,
 * `numeric_input`, `open_answer`, `cloze_dropdown`, `cloze_text`, `matching`,
 * `ordering` (стоп-лист Э8: «НЕ делать типы 11–22»).
 *
 * **Ключи ответов никогда не уходят на клиент до сабмита** (§ «Железные
 * правила» CLAUDE.md) — `stripInteractionAnswerKey` ниже единственная точка,
 * которая решает, что можно показать ученику. Схемы `*InteractionSchema` в
 * этом файле — ПОЛНЫЕ (с ключом ответа), они живут только на сервере
 * (БД, движок проверки); их нельзя отдавать в ответах API до сабмита as-is.
 */

// ─── Контентные блоки (§6.2 ТЗ) — сами по себе не содержат секретов ────────

export const richTextBlockSchema = z.object({
  type: z.literal("rich_text"),
  id: z.string().min(1),
  html: z.string(),
});

export const imageBlockSchema = z.object({
  type: z.literal("image"),
  id: z.string().min(1),
  assetId: z.string().min(1),
  caption: z.string().optional(),
  zoomable: z.boolean().default(false),
});

export const videoBlockSchema = z.object({
  type: z.literal("video"),
  id: z.string().min(1),
  assetId: z.string().min(1),
  posterAssetId: z.string().optional(),
});

export const audioBlockSchema = z.object({
  type: z.literal("audio"),
  id: z.string().min(1),
  assetId: z.string().min(1),
  transcript: z.string().optional(),
});

export const formulaBlockSchema = z.object({
  type: z.literal("formula"),
  id: z.string().min(1),
  latex: z.string().min(1),
});

export const tableBlockSchema = z.object({
  type: z.literal("table"),
  id: z.string().min(1),
  rows: z.array(z.array(z.string())),
});

export const calloutBlockSchema = z.object({
  type: z.literal("callout"),
  id: z.string().min(1),
  variant: z.enum(["note", "warning", "example"]),
  html: z.string(),
});

export const embedBlockSchema = z.object({
  type: z.literal("embed"),
  id: z.string().min(1),
  provider: z.enum(["geogebra", "desmos", "jsxgraph"]),
  config: z.record(z.string(), z.unknown()),
});

export const pageBreakBlockSchema = z.object({
  type: z.literal("page_break"),
  id: z.string().min(1),
});

export const contentBlockSchema = z.discriminatedUnion("type", [
  richTextBlockSchema,
  imageBlockSchema,
  videoBlockSchema,
  audioBlockSchema,
  formulaBlockSchema,
  tableBlockSchema,
  calloutBlockSchema,
  embedBlockSchema,
  pageBreakBlockSchema,
]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

// ─── Типы взаимодействия (§6.3 ТЗ) — ПОЛНЫЕ, содержат ключ ответа ──────────

export const choiceOptionSchema = z.object({
  id: z.string().min(1),
  html: z.string(),
  correct: z.boolean(),
});

export const singleChoiceInteractionSchema = z.object({
  type: z.literal("single_choice"),
  shuffle: z.boolean().default(false),
  options: z.array(choiceOptionSchema).min(2),
});

export const multipleChoiceInteractionSchema = z.object({
  type: z.literal("multiple_choice"),
  shuffle: z.boolean().default(false),
  options: z.array(choiceOptionSchema).min(2),
});

export const trueFalseInteractionSchema = z.object({
  type: z.literal("true_false"),
  correct: z.boolean(),
});

/** exact — посимвольно; normalized — регистр/пробелы по флагам ниже; regex — `value` как регулярное выражение. */
export const textMatchModeSchema = z.enum(["exact", "normalized", "regex"]);
export const textMatchRuleSchema = z.object({
  value: z.string(),
  match: textMatchModeSchema,
});

export const textInputInteractionSchema = z.object({
  type: z.literal("text_input"),
  answers: z.array(textMatchRuleSchema).min(1),
  caseSensitive: z.boolean().default(false),
  trimWhitespace: z.boolean().default(true),
  /** Расстояние Левенштейна, при котором ответ всё ещё считается верным (опечатки). 0 — точное совпадение. */
  typoTolerance: z.number().int().min(0).default(0),
});

export const numericToleranceSchema = z.object({
  kind: z.enum(["absolute", "relative", "percent"]),
  value: z.number().nonnegative(),
});

export const numericInputInteractionSchema = z.object({
  type: z.literal("numeric_input"),
  value: z.number(),
  tolerance: numericToleranceSchema,
  unit: z.string().optional(),
  unitRequired: z.boolean().default(false),
});

export const rubricCriterionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  points: z.number().nonnegative(),
});

export const openAnswerInteractionSchema = z.object({
  type: z.literal("open_answer"),
  maxLength: z.number().int().positive(),
  allowAttachments: z.boolean().default(false),
  rubric: z.array(rubricCriterionSchema).min(1),
});

export const clozeDropdownGapSchema = z.object({
  options: z.array(z.string()).min(2),
  correct: z.string(),
});
export const clozeDropdownInteractionSchema = z.object({
  type: z.literal("cloze_dropdown"),
  /** Текст с плейсхолдерами `{{gapId}}`, ключи которых соответствуют `gaps`. */
  template: z.string().min(1),
  gaps: z.record(z.string(), clozeDropdownGapSchema),
});

export const clozeTextGapSchema = z.object({
  answers: z.array(textMatchRuleSchema).min(1),
  caseSensitive: z.boolean().default(false),
  trimWhitespace: z.boolean().default(true),
  typoTolerance: z.number().int().min(0).default(0),
});
export const clozeTextInteractionSchema = z.object({
  type: z.literal("cloze_text"),
  template: z.string().min(1),
  gaps: z.record(z.string(), clozeTextGapSchema),
});

export const matchingItemSchema = z.object({ id: z.string().min(1), html: z.string() });
export const matchingInteractionSchema = z.object({
  type: z.literal("matching"),
  left: z.array(matchingItemSchema).min(1),
  right: z.array(matchingItemSchema).min(1),
  /** Правильные пары `[leftId, rightId]`. */
  pairs: z.array(z.tuple([z.string(), z.string()])).min(1),
  scoring: z.enum(["all_or_nothing", "partial"]),
  /** id элементов `right` без пары — усложняют угадывание. */
  distractors: z.array(z.string()).default([]),
});

export const orderingItemSchema = z.object({ id: z.string().min(1), html: z.string() });
export const orderingInteractionSchema = z.object({
  type: z.literal("ordering"),
  /**
   * ПОРЯДОК ЭЛЕМЕНТОВ В МАССИВЕ — И ЕСТЬ ПРАВИЛЬНЫЙ ОТВЕТ (как `left`/`right`
   * у `matching`, отдельного поля-ключа нет). Поэтому `stripInteractionAnswerKey`
   * ниже ОБЯЗАН перемешать `items` перед отправкой ученику — отдать их as-is
   * значит напрямую показать ответ в самом порядке массива.
   */
  items: z.array(orderingItemSchema).min(2),
});

export const questionInteractionSchema = z.discriminatedUnion("type", [
  singleChoiceInteractionSchema,
  multipleChoiceInteractionSchema,
  trueFalseInteractionSchema,
  textInputInteractionSchema,
  numericInputInteractionSchema,
  openAnswerInteractionSchema,
  clozeDropdownInteractionSchema,
  clozeTextInteractionSchema,
  matchingInteractionSchema,
  orderingInteractionSchema,
]);
export type QuestionInteraction = z.infer<typeof questionInteractionSchema>;
export type InteractionType = QuestionInteraction["type"];

// ─── Блок-вопрос (§6.3 ТЗ, «общая обёртка вопроса») ────────────────────────

export const richTextFragmentSchema = z.object({ html: z.string() });

export const questionBlockSchema = z.object({
  type: z.literal("question"),
  id: z.string().min(1),
  prompt: richTextFragmentSchema,
  points: z.number().nonnegative(),
  hint: richTextFragmentSchema.optional(),
  feedback: z
    .object({
      correct: richTextFragmentSchema.optional(),
      incorrect: richTextFragmentSchema.optional(),
    })
    .optional(),
  interaction: questionInteractionSchema,
});
export type QuestionBlock = z.infer<typeof questionBlockSchema>;

export const materialBlockSchema = z.discriminatedUnion("type", [
  ...contentBlockSchema.options,
  questionBlockSchema,
]);
export type MaterialBlock = z.infer<typeof materialBlockSchema>;

// ─── Материал целиком (§6.1 ТЗ) ────────────────────────────────────────────

/** never — не показывать вовсе; immediate — сразу после ответа на вопрос; after_submit — после сдачи всей работы; after_deadline — после дедлайна (Э8.6). */
export const showFeedbackSchema = z.enum(["never", "immediate", "after_submit", "after_deadline"]);
export type ShowFeedback = z.infer<typeof showFeedbackSchema>;

export const materialSettingsSchema = z.object({
  shuffleBlocks: z.boolean().default(false),
  showFeedback: showFeedbackSchema.default("after_submit"),
  attemptsAllowed: z.number().int().positive().default(1),
  /** Доля от максимального балла (0..1) для «зачёта» — используется в отчётах Э8.9, не блокирует сдачу. */
  passingScore: z.number().min(0).max(1).optional(),
});
export type MaterialSettings = z.infer<typeof materialSettingsSchema>;

export const materialSchema = z.object({
  id: z.string().min(1),
  /** Версия ФОРМАТА JSON (эта схема), не версия содержимого материала (`material_versions`, Э8.2/Э9.8). */
  schemaVersion: z.literal(1),
  title: z.string().min(1),
  subject: z.string().min(1),
  grades: z.array(z.number().int().positive()).min(1),
  tags: z.array(z.string()).default([]),
  estimatedMinutes: z.number().int().positive().optional(),
  settings: materialSettingsSchema,
  blocks: z.array(materialBlockSchema),
});
export type Material = z.infer<typeof materialSchema>;

// ─── Ответы ученика (§6.5 ТЗ, `responses.response`) ────────────────────────
// Форма ответа зеркалит соответствующий interaction — тоже дискриминированное
// объединение по `type`, чтобы движок проверки (Э8.3) мог сузить тип по
// `interaction.type === response.type` без приведений.

export const singleChoiceResponseSchema = z.object({
  type: z.literal("single_choice"),
  selectedOptionId: z.string().nullable(),
});
export const multipleChoiceResponseSchema = z.object({
  type: z.literal("multiple_choice"),
  selectedOptionIds: z.array(z.string()),
});
export const trueFalseResponseSchema = z.object({
  type: z.literal("true_false"),
  value: z.boolean().nullable(),
});
export const textInputResponseSchema = z.object({
  type: z.literal("text_input"),
  value: z.string(),
});
export const numericInputResponseSchema = z.object({
  type: z.literal("numeric_input"),
  value: z.number().nullable(),
  unit: z.string().optional(),
});
export const openAnswerResponseSchema = z.object({
  type: z.literal("open_answer"),
  text: z.string(),
  attachmentIds: z.array(z.string()).default([]),
});
export const clozeDropdownResponseSchema = z.object({
  type: z.literal("cloze_dropdown"),
  /** По ключу gapId — выбранное значение или `null`, если ученик не заполнил пропуск. */
  values: z.record(z.string(), z.string().nullable()),
});
export const clozeTextResponseSchema = z.object({
  type: z.literal("cloze_text"),
  values: z.record(z.string(), z.string()),
});
export const matchingResponseSchema = z.object({
  type: z.literal("matching"),
  pairs: z.array(z.tuple([z.string(), z.string()])),
});
export const orderingResponseSchema = z.object({
  type: z.literal("ordering"),
  order: z.array(z.string()),
});

export const questionResponseSchema = z.discriminatedUnion("type", [
  singleChoiceResponseSchema,
  multipleChoiceResponseSchema,
  trueFalseResponseSchema,
  textInputResponseSchema,
  numericInputResponseSchema,
  openAnswerResponseSchema,
  clozeDropdownResponseSchema,
  clozeTextResponseSchema,
  matchingResponseSchema,
  orderingResponseSchema,
]);
export type QuestionResponse = z.infer<typeof questionResponseSchema>;

/**
 * Результат проверки одного ответа (§6.5 ТЗ, движок проверки — Э8.3, ещё не
 * реализован, это только контракт результата). `correct: null` — типы 6/20/21
 * (ручная проверка, §6.4 ТЗ), ждут `graded_by`/`graded_at`; для остальных —
 * `true`/`false` по формуле частичных баллов (§6.4 ТЗ: `max(0, (верных −
 * неверных) / всего)` для `multiple_choice`/`matching`/`cloze_*`).
 */
export const gradeResultSchema = z.object({
  score: z.number().nonnegative(),
  maxScore: z.number().nonnegative(),
  correct: z.boolean().nullable(),
  autoGraded: z.boolean(),
});
export type GradeResult = z.infer<typeof gradeResultSchema>;

// ─── Сокрытие ключа ответа (§ «Железные правила» CLAUDE.md) ────────────────

/** Простой детерминированный PRNG (mulberry32 поверх строкового seed) — не криптографический, для перемешивания вариантов ответа этого достаточно: seed стабилен на попытку (`attemptId:questionId`), результат воспроизводим при повторной отдаче того же вопроса той же попытке. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function next() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Единственная точка, которая решает, что из `interaction` можно показать
 * ученику ДО сабмита (§ «Железные правила» CLAUDE.md: «Ключи ответов на
 * задания никогда не уходят на клиент до сабмита»). Явный `switch` по
 * каждому типу, а не общий `omit` по дискриминированному объединению —
 * ошибка здесь тихо портит оценки/раскрывает ответ, поэтому каждый case
 * перечисляет БЕЛЫЙ список безопасных полей, а не чёрный список секретных
 * (забытое новое секретное поле в чёрном списке утекло бы по умолчанию;
 * в белом — просто не появится, пока его не добавят явно).
 *
 * `seed` обязателен для `single_choice`/`multiple_choice` с `shuffle: true`
 * и для `ordering` (там перемешивание не опция, а необходимость — порядок
 * элементов в хранении и есть ответ, см. комментарий у `orderingInteractionSchema`).
 * Один и тот же `seed` (например, `` `${attemptId}:${questionId}` ``) даёт
 * одно и то же перемешивание при повторной отдаче — важно для страницы,
 * перезагруженной посреди попытки.
 */
export function stripInteractionAnswerKey(interaction: QuestionInteraction, seed: string) {
  switch (interaction.type) {
    case "single_choice":
    case "multiple_choice": {
      const options = interaction.options.map((o) => ({ id: o.id, html: o.html }));
      return {
        type: interaction.type,
        options: interaction.shuffle ? shuffled(options, seededRandom(seed)) : options,
      };
    }
    case "true_false":
      return { type: interaction.type };
    case "text_input":
      return { type: interaction.type };
    case "numeric_input":
      return { type: interaction.type, unit: interaction.unit, unitRequired: interaction.unitRequired };
    case "open_answer":
      return {
        type: interaction.type,
        maxLength: interaction.maxLength,
        allowAttachments: interaction.allowAttachments,
      };
    case "cloze_dropdown":
      return {
        type: interaction.type,
        template: interaction.template,
        gaps: Object.fromEntries(
          Object.entries(interaction.gaps).map(([gapId, gap]) => [gapId, { options: gap.options }]),
        ),
      };
    case "cloze_text":
      return {
        type: interaction.type,
        template: interaction.template,
        gapIds: Object.keys(interaction.gaps),
      };
    case "matching":
      return {
        type: interaction.type,
        left: interaction.left,
        right: interaction.right,
        distractors: interaction.distractors,
        scoring: interaction.scoring,
      };
    case "ordering":
      return {
        type: interaction.type,
        items: shuffled(interaction.items, seededRandom(seed)),
      };
  }
}
export type PublicQuestionInteraction = ReturnType<typeof stripInteractionAnswerKey>;

/** `question`-блок без ключа ответа — то, что реально уходит ученику до сабмита. `feedback` тоже не отдаётся: раскрывает верный вариант через текст обратной связи (`showFeedback` решает, когда его прислать отдельным запросом, — Э8.6/8.10, ещё не сделаны). */
export function stripQuestionBlockAnswerKey(block: QuestionBlock, seed: string) {
  return {
    type: block.type,
    id: block.id,
    prompt: block.prompt,
    points: block.points,
    hint: block.hint,
    interaction: stripInteractionAnswerKey(block.interaction, `${seed}:${block.id}`),
  };
}
export type PublicQuestionBlock = ReturnType<typeof stripQuestionBlockAnswerKey>;

/** Материал без ключей ответов — контентные блоки не меняются, `question`-блоки проходят через `stripQuestionBlockAnswerKey`. */
export function stripMaterialAnswerKeys(material: Material, seed: string) {
  return {
    ...material,
    blocks: material.blocks.map((block) =>
      block.type === "question" ? stripQuestionBlockAnswerKey(block, seed) : block,
    ),
  };
}
export type PublicMaterial = ReturnType<typeof stripMaterialAnswerKeys>;
