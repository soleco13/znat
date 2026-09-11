import {
  BookMarked,
  BookOpen,
  Calculator,
  Code2,
  FileText,
  FlaskConical,
  Globe,
  Landmark,
  Leaf,
  ListChecks,
  Map,
  Palette,
  PenLine,
  Quote,
  Sigma,
  SpellCheck2,
  SquareCheckBig,
  Zap,
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
/**
 * Порядок разделов в пикере (`construct-picker.tsx`) — сначала предметно-
 * нейтральные конструкции, затем по школьным предметам (Э13, доп.
 * «внедряй всё»: интерактив не только по математике). Любой `subject`,
 * которого нет в этом списке, попадёт в пикер последним отдельным
 * разделом — на будущее, если появится ещё предмет.
 */
export const CONSTRUCT_SUBJECT_ORDER = [
  "Общее",
  "Русский язык",
  "Литература",
  "Английский язык",
  "Математика",
  "Физика",
  "Химия",
  "Биология",
  "География",
  "История и обществознание",
  "Информатика",
  "Музыка, ИЗО, ОБЖ",
] as const;

export interface MaterialConstruct {
  id: string;
  kind: "group" | "block";
  /** Раздел пикера — школьный предмет или «Общее» (не привязывает материал к предмету, только группирует карточки). */
  subject: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Короткая схема состава — чипы на карточке пикера. */
  outline: string[];
  /**
   * Слова/фразы в тексте, при которых редактор подсказывает эту
   * конструкцию (Э13). Однословные — по границе слова, многословные —
   * подстрокой; регистр не важен.
   */
  triggers: string[];
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
      html,
      correct: i === correctIndex,
    })),
  };
  return block;
}

function image(caption?: string): MaterialBlock {
  const block = createContentBlock("image", crypto.randomUUID());
  if (block.type === "image" && caption) block.caption = caption;
  return block;
}

function audioBlock(transcript?: string): MaterialBlock {
  const block = createContentBlock("audio", crypto.randomUUID());
  if (block.type === "audio" && transcript) block.transcript = transcript;
  return block;
}

function table(rows: string[][]): MaterialBlock {
  const block = createContentBlock("table", crypto.randomUUID());
  if (block.type === "table") block.rows = rows;
  return block;
}

/** Пары `[левое, правое]` — методист доредактирует подписи, связи уже расставлены. */
function matchingQuestion(promptHtml: string, pairs: [string, string][], points = 1): MaterialBlock {
  const block = createQuestionBlock("matching", crypto.randomUUID());
  block.prompt = { html: promptHtml };
  block.points = points;
  const left = pairs.map(([l]) => ({ id: crypto.randomUUID(), html: l }));
  const right = pairs.map(([, r]) => ({ id: crypto.randomUUID(), html: r }));
  block.interaction = {
    type: "matching",
    left,
    right,
    pairs: left.map((l, i) => [l.id, right[i]!.id] as [string, string]),
    scoring: "all_or_nothing",
    distractors: [],
  };
  return block;
}

/** Порядок элементов массива — правильный порядок (как у `orderingInteractionSchema`). */
function orderingQuestion(promptHtml: string, itemsHtml: string[], points = 1): MaterialBlock {
  const block = createQuestionBlock("ordering", crypto.randomUUID());
  block.prompt = { html: promptHtml };
  block.points = points;
  block.interaction = {
    type: "ordering",
    items: itemsHtml.map((html) => ({ id: crypto.randomUUID(), html })),
  };
  return block;
}

/** `groups` — `[название категории, [элементы этой категории]]`. */
function categorizeQuestion(promptHtml: string, groups: [string, string[]][], points = 1): MaterialBlock {
  const block = createQuestionBlock("categorize", crypto.randomUUID());
  block.prompt = { html: promptHtml };
  block.points = points;
  const categories = groups.map(([label]) => ({ id: crypto.randomUUID(), label }));
  const items = groups.flatMap(([, labels], i) =>
    labels.map((html) => ({ id: crypto.randomUUID(), html, categoryId: categories[i]!.id })),
  );
  block.interaction = { type: "categorize", shuffle: true, categories, items };
  return block;
}

/** `words` — `[текст слова, искомое ли]`, по порядку в предложении. */
function highlightTextQuestion(promptHtml: string, words: [string, boolean][], points = 1): MaterialBlock {
  const block = createQuestionBlock("highlight_text", crypto.randomUUID());
  block.prompt = { html: promptHtml };
  block.points = points;
  block.interaction = {
    type: "highlight_text",
    tokens: words.map(([text, correct]) => ({ id: crypto.randomUUID(), text, correct })),
  };
  return block;
}

/**
 * `rows` — `[текст, ...][]`, ячейка `null` → поле ответа (заготовка без
 * правильного ответа, методист впишет сам), строка → статичный текст.
 */
function tableFillQuestion(promptHtml: string, rows: (string | null)[][], points = 1): MaterialBlock {
  const block = createQuestionBlock("table_fill", crypto.randomUUID());
  block.prompt = { html: promptHtml };
  block.points = points;
  block.interaction = {
    type: "table_fill",
    rows: rows.map((row) =>
      row.map((cell) =>
        cell === null
          ? {
              kind: "input" as const,
              id: crypto.randomUUID(),
              answers: [{ value: "", match: "normalized" as const }],
              caseSensitive: false,
              trimWhitespace: true,
              typoTolerance: 0,
            }
          : { kind: "static" as const, text: cell },
      ),
    ),
  };
  return block;
}

/** `template` — текст с `{{gapId}}`, ключи `gaps` должны совпадать. */
function clozeDropdownQuestion(
  promptHtml: string,
  template: string,
  gaps: Record<string, { options: string[]; correct: string }>,
  points = 1,
): MaterialBlock {
  const block = createQuestionBlock("cloze_dropdown", crypto.randomUUID());
  block.prompt = { html: promptHtml };
  block.points = points;
  block.interaction = { type: "cloze_dropdown", template, gaps };
  return block;
}

export const MATERIAL_CONSTRUCTS: MaterialConstruct[] = [
  // ─── Многоблочные каркасы ────────────────────────────────────────────────
  {
    id: "problem_walkthrough",
    kind: "group",
    subject: "Общее",
    label: "Разбор задачи",
    description: "Условие, формула, пошаговое решение и вопрос с числовым ответом.",
    icon: Calculator,
    outline: ["Условие", "Формула", "Шаг 1", "Шаг 2", "Числовой вопрос"],
    triggers: ["реши","решим","решите","разбор","разберём","найдите","вычислите","дано:","условие задачи","пример решения"],
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
    subject: "Общее",
    label: "Блок проверки",
    description: "Короткая инструкция и три вопроса с одним правильным ответом.",
    icon: ListChecks,
    outline: ["Инструкция", "Вопрос 1", "Вопрос 2", "Вопрос 3"],
    triggers: ["проверим","проверка","закрепим","ответьте на вопрос","тест","мини-тест","вопросы для проверки"],
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
    subject: "Общее",
    label: "Словарный диктант",
    description: "Вступление и пять текстовых вопросов — по одному на слово.",
    icon: SpellCheck2,
    outline: ["Вступление", "5 × слово"],
    triggers: ["диктант","словарн","запишите слов","напишите без ошибок","орфограмм","под диктовку"],
    build: () => [
      richText("<p>Учитель диктует слово — впишите его без ошибок.</p>"),
      ...Array.from({ length: 5 }, (_, i) => question("text_input", `<p>Слово ${i + 1}</p>`)),
    ],
  },
  {
    id: "definition_block",
    kind: "group",
    subject: "Общее",
    label: "Определение и теорема",
    description: "Три врезки: определение, теорема, пример применения.",
    icon: BookMarked,
    outline: ["Определение", "Теорема", "Пример"],
    triggers: ["определение и теорема","введём понятие","новое понятие"],
    build: () => [
      callout("note", "<p><strong>Определение.</strong> </p>"),
      callout("warning", "<p><strong>Теорема.</strong> </p>"),
      callout("example", "<p><strong>Пример.</strong> </p>"),
    ],
  },
  {
    id: "paragraph_with_check",
    kind: "group",
    subject: "Общее",
    label: "Параграф с проверкой",
    description: "Подзаголовок и текст параграфа, затем два вопроса на понимание.",
    icon: FileText,
    outline: ["Текст параграфа", "Вопрос-выбор", "Верно/неверно"],
    triggers: ["параграф","изучите","прочитайте","новая тема","разберём тему"],
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
    subject: "Общее",
    label: "Врезка «Определение»",
    description: "Синяя врезка с заголовком «Определение».",
    icon: Quote,
    outline: ["Врезка · заметка"],
    triggers: ["определение","называется","определяется как","по определению","термин"],
    build: () => [callout("note", "<p><strong>Определение.</strong> </p>")],
  },
  {
    id: "theorem_callout",
    kind: "block",
    subject: "Общее",
    label: "Врезка «Теорема»",
    description: "Врезка-предупреждение с заголовком «Теорема».",
    icon: Quote,
    outline: ["Врезка · внимание"],
    triggers: ["теорема","лемма","следствие","утверждение","свойство","правило"],
    build: () => [callout("warning", "<p><strong>Теорема.</strong> </p>")],
  },
  {
    id: "example_callout",
    kind: "block",
    subject: "Общее",
    label: "Врезка «Пример»",
    description: "Врезка с разобранным примером.",
    icon: Quote,
    outline: ["Врезка · пример"],
    triggers: ["пример","например","к примеру","рассмотрим случай","проиллюстрируем"],
    build: () => [callout("example", "<p><strong>Пример.</strong> </p>")],
  },
  {
    id: "mc4",
    kind: "block",
    subject: "Общее",
    label: "Вопрос: выбор из 4",
    description: "Вопрос с одним правильным ответом и четырьмя вариантами.",
    icon: SquareCheckBig,
    outline: ["Один ответ · 4 варианта"],
    triggers: ["выберите вариант","какой из","что из перечисленного","отметьте верное"],
    build: () => [
      mcQuestion("<p>Формулировка вопроса</p>", ["Вариант 1", "Вариант 2", "Вариант 3", "Вариант 4"], 0),
    ],
  },
  {
    id: "numeric_tolerance",
    kind: "block",
    subject: "Общее",
    label: "Числовой ответ с допуском",
    description: "Числовой вопрос с относительным допуском 1 %.",
    icon: Sigma,
    outline: ["Число · допуск ±1 %"],
    triggers: ["вычислите","чему равно","чему равен","найдите значение","посчитайте","рассчитайте"],
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

  // ─── Русский язык ───────────────────────────────────────────────────────
  {
    id: "ru_missing_letter",
    kind: "group",
    subject: "Русский язык",
    label: "Вставь пропущенную букву",
    description: "Восемь слов с пропущенной буквой — впишите слово целиком.",
    icon: PenLine,
    outline: ["Инструкция", "8 × слово"],
    triggers: ["вставь букву", "пропущенн", "орфограмма", "безударная гласная"],
    build: () => [
      richText("<p>Вставьте пропущенную букву и впишите слово целиком.</p>"),
      ...Array.from({ length: 8 }, (_, i) => question("text_input", `<p>Слово ${i + 1}: п_ход</p>`)),
    ],
  },
  {
    id: "ru_punctuation",
    kind: "group",
    subject: "Русский язык",
    label: "Расставь знаки препинания",
    description: "Предложение с пропуском — выберите нужный знак.",
    icon: PenLine,
    outline: ["Предложение", "Выбор знака"],
    triggers: ["расставь знаки", "знаки препинания", "запятая нужна", "обособление"],
    build: () => [
      richText("<p>Выберите знак препинания, который нужно поставить на месте пропуска.</p>"),
      clozeDropdownQuestion(
        "<p>Вставьте знак препинания</p>",
        "Мама пришла домой{{g1}} и сняла пальто.",
        { g1: { options: [",", "—", "нет знака"], correct: "," } },
      ),
    ],
  },
  {
    id: "ru_stress",
    kind: "group",
    subject: "Русский язык",
    label: "Орфоэпическая разминка",
    description: "Пять слов — отметьте вариант с правильным ударением.",
    icon: PenLine,
    outline: ["5 × ударение"],
    triggers: ["ударение", "орфоэпия", "произношение", "как правильно произносится"],
    build: () => [
      richText("<p>Отметьте слово с верно поставленным ударением.</p>"),
      ...Array.from({ length: 5 }, (_, i) =>
        mcQuestion(`<p>Вопрос ${i + 1}: где ударение?</p>`, ["ва́рианты", "вариа́нты", "варианты́", "вари́анты"], 0),
      ),
    ],
  },
  {
    id: "ru_word_parts",
    kind: "group",
    subject: "Русский язык",
    label: "Разбор слова по составу",
    description: "Слово-заготовка — выделите приставку, корень, суффикс, окончание.",
    icon: PenLine,
    outline: ["Слово", "4 × морфема"],
    triggers: ["разбор слова по составу", "морфемный разбор", "выдели корень", "приставка суффикс"],
    build: () => [
      richText("<h3>Разбор слова по составу</h3><p>Слово: <strong>подснежник</strong></p>"),
      question("text_input", "<p>Приставка</p>"),
      question("text_input", "<p>Корень</p>"),
      question("text_input", "<p>Суффикс</p>"),
      question("text_input", "<p>Окончание</p>"),
    ],
  },
  {
    id: "ru_syntax_parse",
    kind: "block",
    subject: "Русский язык",
    label: "Синтаксический разбор предложения",
    description: "Выделите в предложении подлежащее и сказуемое — клик по словам.",
    icon: PenLine,
    outline: ["Выделение в тексте"],
    triggers: ["синтаксический разбор", "члены предложения", "подлежащее и сказуемое", "разбери по членам"],
    build: () => [
      highlightTextQuestion("<p>Выделите подлежащее и сказуемое</p>", [
        ["Дети", true],
        ["весело", false],
        ["играли", true],
        ["во", false],
        ["дворе", false],
      ]),
    ],
  },
  {
    id: "ru_fix_error",
    kind: "group",
    subject: "Русский язык",
    label: "Найди и исправь ошибку",
    description: "Предложение с ошибкой — впишите исправленный вариант.",
    icon: PenLine,
    outline: ["Предложение с ошибкой", "Исправленный вариант"],
    triggers: ["найди ошибку", "исправь предложение", "речевая ошибка", "грамматическая ошибка"],
    build: () => [
      richText("<p>В предложении есть ошибка. Перепишите его правильно.</p>"),
      question("text_input", "<p>Исправленное предложение</p>"),
    ],
  },
  {
    id: "ru_text_work",
    kind: "group",
    subject: "Русский язык",
    label: "Работа с текстом (ОГЭ/ЕГЭ)",
    description: "Текст-заготовка и пять вопросов разных типов на понимание.",
    icon: PenLine,
    outline: ["Текст", "3 × выбор", "Верно/неверно", "Развёрнутый ответ"],
    triggers: ["прочитайте текст", "по данному тексту", "текст для анализа", "формат огэ", "формат егэ"],
    build: () => [
      richText("<h3>Текст</h3><p>Текст для анализа.</p>"),
      question("single_choice", "<p>Вопрос 1 по тексту</p>"),
      question("single_choice", "<p>Вопрос 2 по тексту</p>"),
      question("single_choice", "<p>Вопрос 3 по тексту</p>"),
      question("true_false", "<p>Утверждение по тексту — верно или неверно?</p>"),
      question("open_answer", "<p>Развёрнуто ответьте на вопрос по тексту</p>"),
    ],
  },
  {
    id: "ru_parts_of_speech",
    kind: "block",
    subject: "Русский язык",
    label: "Части речи",
    description: "Разложите слова по частям речи — перетаскивание по корзинам.",
    icon: PenLine,
    outline: ["Категоризация · 2 группы"],
    triggers: ["часть речи", "имя существительное", "имя прилагательное", "распредели слова"],
    build: () => [
      categorizeQuestion("<p>Разложите слова по частям речи</p>", [
        ["Существительное", ["дом", "окно", "книга"]],
        ["Прилагательное", ["красивый"]],
      ]),
    ],
  },

  // ─── Литература ─────────────────────────────────────────────────────────
  {
    id: "lit_quote_analysis",
    kind: "group",
    subject: "Литература",
    label: "Цитата и анализ",
    description: "Цитата из произведения + развёрнутый вопрос с рубрикой оценки.",
    icon: BookOpen,
    outline: ["Цитата", "Развёрнутый ответ"],
    triggers: ["проанализируйте цитату", "прокомментируйте отрывок", "как вы понимаете слова"],
    build: () => [
      callout("example", "<p><strong>Цитата.</strong> «…»</p>"),
      question("open_answer", "<p>Как вы понимаете смысл этой цитаты?</p>"),
    ],
  },
  {
    id: "lit_author_match",
    kind: "group",
    subject: "Литература",
    label: "Кто автор строк",
    description: "Сопоставьте цитаты с их авторами.",
    icon: BookOpen,
    outline: ["Сопоставление · 3 пары"],
    triggers: ["кто автор", "чьи это строки", "определите автора"],
    build: () => [
      richText("<p>Сопоставьте цитаты и их авторов.</p>"),
      matchingQuestion("<p>Сопоставьте цитату и автора</p>", [
        ["Цитата 1", "Автор 1"],
        ["Цитата 2", "Автор 2"],
        ["Цитата 3", "Автор 3"],
      ]),
    ],
  },
  {
    id: "lit_hero_work",
    kind: "group",
    subject: "Литература",
    label: "Герой — произведение",
    description: "Сопоставьте героя с произведением, в котором он действует.",
    icon: BookOpen,
    outline: ["Сопоставление · 3 пары"],
    triggers: ["из какого произведения герой", "кому принадлежит герой"],
    build: () => [
      matchingQuestion("<p>Сопоставьте героя и произведение</p>", [
        ["Герой 1", "Произведение 1"],
        ["Герой 2", "Произведение 2"],
        ["Герой 3", "Произведение 3"],
      ]),
    ],
  },
  {
    id: "lit_timeline",
    kind: "group",
    subject: "Литература",
    label: "Хронология сюжета",
    description: "Расставьте события произведения в правильном порядке.",
    icon: BookOpen,
    outline: ["Упорядочивание · 4 события"],
    triggers: ["восстановите порядок событий", "хронология сюжета", "что произошло сначала"],
    build: () => [
      orderingQuestion("<p>Расставьте события в порядке сюжета</p>", [
        "Событие 1",
        "Событие 2",
        "Событие 3",
        "Событие 4",
      ]),
    ],
  },
  {
    id: "lit_expressive_means",
    kind: "group",
    subject: "Литература",
    label: "Средства выразительности",
    description: "Найдите в отрывке нужное слово (клик) + вопрос о приёме.",
    icon: BookOpen,
    outline: ["Выделение в тексте", "Выбор приёма"],
    triggers: ["средство выразительности", "художественный приём", "эпитет метафора"],
    build: () => [
      highlightTextQuestion("<p>Найдите в отрывке эпитет</p>", [
        ["Отрывок", false],
        ["текста", false],
        ["для", false],
        ["анализа", false],
      ]),
      mcQuestion(
        "<p>Какое средство выразительности вы нашли?</p>",
        ["Эпитет", "Метафора", "Сравнение", "Олицетворение"],
        0,
      ),
    ],
  },
  {
    id: "lit_essay",
    kind: "block",
    subject: "Литература",
    label: "Сочинение-миниатюра",
    description: "Развёрнутый ответ с рубрикой из трёх критериев оценки.",
    icon: BookOpen,
    outline: ["Развёрнутый ответ · 3 критерия"],
    triggers: ["напишите сочинение", "мини-сочинение", "эссе на тему"],
    build: () => {
      const block = createQuestionBlock("open_answer", crypto.randomUUID());
      block.prompt = { html: "<p>Напишите сочинение-миниатюру на тему</p>" };
      block.points = 3;
      block.interaction = {
        type: "open_answer",
        maxLength: 1500,
        allowAttachments: false,
        rubric: [
          { id: crypto.randomUUID(), label: "Раскрытие темы", points: 1 },
          { id: crypto.randomUUID(), label: "Структура и логика", points: 1 },
          { id: crypto.randomUUID(), label: "Грамотность", points: 1 },
        ],
      };
      return [block];
    },
  },

  // ─── Английский язык ────────────────────────────────────────────────────
  {
    id: "en_vocab_match",
    kind: "group",
    subject: "Английский язык",
    label: "Слово — перевод",
    description: "Сопоставьте английские слова с переводом.",
    icon: Globe,
    outline: ["Сопоставление · 5 пар"],
    triggers: ["match the words", "word list", "vocabulary", "переведите слова"],
    build: () => [
      matchingQuestion("<p>Match the word with its translation</p>", [
        ["word 1", "перевод 1"],
        ["word 2", "перевод 2"],
        ["word 3", "перевод 3"],
        ["word 4", "перевод 4"],
        ["word 5", "перевод 5"],
      ]),
    ],
  },
  {
    id: "en_listening",
    kind: "group",
    subject: "Английский язык",
    label: "Listening",
    description: "Аудиофрагмент и два вопроса на понимание услышанного.",
    icon: Globe,
    outline: ["Аудио", "Вопрос 1", "Вопрос 2"],
    triggers: ["listen and answer", "аудирование", "прослушайте запись"],
    build: () => [
      audioBlock("Транскрипт аудиозаписи."),
      question("single_choice", "<p>What is the text about?</p>"),
      question("true_false", "<p>True or false statement about the recording</p>"),
    ],
  },
  {
    id: "en_grammar_gaps",
    kind: "group",
    subject: "Английский язык",
    label: "Грамматика: выбери форму",
    description: "Предложение с пропуском — выберите верную грамматическую форму.",
    icon: Globe,
    outline: ["Предложение", "Выбор формы"],
    triggers: ["choose the correct form", "present simple", "past tense", "грамматический тест"],
    build: () => [
      clozeDropdownQuestion(
        "<p>Choose the correct verb form</p>",
        "She {{g1}} to school every day.",
        { g1: { options: ["go", "goes", "going"], correct: "goes" } },
      ),
    ],
  },
  {
    id: "en_word_order",
    kind: "group",
    subject: "Английский язык",
    label: "Порядок слов в предложении",
    description: "Составьте вопрос из слов в правильном порядке.",
    icon: Globe,
    outline: ["Упорядочивание слов"],
    triggers: ["put the words in order", "make a sentence", "word order"],
    build: () => [
      orderingQuestion("<p>Put the words in the correct order</p>", ["Where", "do", "you", "live", "?"]),
    ],
  },
  {
    id: "en_dialogue_gaps",
    kind: "group",
    subject: "Английский язык",
    label: "Диалог с пропусками",
    description: "Реплики диалога — впишите пропущенные фразы.",
    icon: Globe,
    outline: ["Реплика 1", "Реплика 2"],
    triggers: ["complete the dialogue", "fill in the dialogue", "диалог с пропусками"],
    build: () => [
      richText("<p>Complete the dialogue with your own lines.</p>"),
      question("text_input", "<p>— Hello! ___</p>"),
      question("text_input", "<p>— ___ Thank you, bye!</p>"),
    ],
  },
  {
    id: "en_word_formation",
    kind: "group",
    subject: "Английский язык",
    label: "Word formation",
    description: "Три однокоренных слова — образуйте нужную часть речи.",
    icon: Globe,
    outline: ["3 × словообразование"],
    triggers: ["word formation", "form the correct word", "образуйте слово"],
    build: () => [
      richText("<p>Form the correct word from the word in brackets.</p>"),
      ...Array.from({ length: 3 }, (_, i) => question("text_input", `<p>Задание ${i + 1}</p>`)),
    ],
  },

  // ─── Математика ─────────────────────────────────────────────────────────
  {
    id: "math_equation",
    kind: "block",
    subject: "Математика",
    label: "Реши уравнение",
    description: "Числовой ответ с абсолютным допуском — под уравнение.",
    icon: Calculator,
    outline: ["Уравнение", "Числовой ответ"],
    triggers: ["реши уравнение", "найдите корень уравнения", "решите уравнение"],
    build: () => {
      const block = createQuestionBlock("numeric_input", crypto.randomUUID());
      block.prompt = { html: "<p>Решите уравнение и укажите x</p>" };
      block.interaction = { type: "numeric_input", value: 0, tolerance: { kind: "absolute", value: 0.01 }, unitRequired: false };
      return [block];
    },
  },
  {
    id: "math_formula_chain",
    kind: "group",
    subject: "Математика",
    label: "Формула → подстановка → ответ",
    description: "Формула, пояснение подстановки и числовой вопрос.",
    icon: Calculator,
    outline: ["Формула", "Пояснение", "Числовой вопрос"],
    triggers: ["подставим значения", "по формуле найдём", "используя формулу"],
    build: () => [
      formula("S = v \\cdot t"),
      richText("<p>Подставьте известные значения в формулу.</p>"),
      question("numeric_input", "<p>Чему равен результат?</p>"),
    ],
  },
  {
    id: "math_proof_steps",
    kind: "group",
    subject: "Математика",
    label: "Шаги доказательства",
    description: "Расставьте шаги доказательства в правильном порядке.",
    icon: Calculator,
    outline: ["Упорядочивание · 4 шага"],
    triggers: ["докажите", "порядок доказательства", "расставьте шаги"],
    build: () => [
      orderingQuestion("<p>Расставьте шаги доказательства по порядку</p>", ["Шаг 1", "Шаг 2", "Шаг 3", "Шаг 4"]),
    ],
  },
  {
    id: "math_figure_problem",
    kind: "group",
    subject: "Математика",
    label: "Задача с чертежом",
    description: "Изображение чертежа + числовой ответ по условию.",
    icon: Calculator,
    outline: ["Чертёж", "Числовой ответ"],
    triggers: ["по чертежу найдите", "на рисунке изображён", "используя чертёж"],
    build: () => [image("Чертёж к задаче"), question("numeric_input", "<p>Найдите значение по чертежу</p>")],
  },
  {
    id: "math_find_error",
    kind: "group",
    subject: "Математика",
    label: "Найди ошибку в решении",
    description: "Готовое решение с ошибкой — укажите, на каком шаге она допущена.",
    icon: Calculator,
    outline: ["Решение", "Выбор шага"],
    triggers: ["найдите ошибку в решении", "на каком шаге ошибка", "проверьте решение"],
    build: () => [
      richText("<h3>Решение</h3><p>Шаг 1. …<br>Шаг 2. …<br>Шаг 3. …</p>"),
      mcQuestion("<p>На каком шаге допущена ошибка?</p>", ["Шаг 1", "Шаг 2", "Шаг 3", "Ошибки нет"], 0),
    ],
  },
  {
    id: "math_mental_math",
    kind: "block",
    subject: "Математика",
    label: "Устный счёт",
    description: "Десять быстрых числовых вопросов подряд.",
    icon: Calculator,
    outline: ["10 × числовой ответ"],
    triggers: ["устный счёт", "посчитайте быстро", "разминка"],
    build: () => Array.from({ length: 10 }, (_, i) => question("numeric_input", `<p>${i + 1}. Пример</p>`)),
  },

  // ─── Физика ──────────────────────────────────────────────────────────────
  {
    id: "phys_units_problem",
    kind: "block",
    subject: "Физика",
    label: "Задача с единицами измерения",
    description: "Числовой ответ с обязательным указанием единицы измерения.",
    icon: Zap,
    outline: ["Число + единица"],
    triggers: ["в каких единицах", "с указанием единиц измерения", "выразите в си"],
    build: () => {
      const block = createQuestionBlock("numeric_input", crypto.randomUUID());
      block.prompt = { html: "<p>Найдите значение с единицей измерения</p>" };
      block.interaction = {
        type: "numeric_input",
        value: 0,
        tolerance: { kind: "relative", value: 0.02 },
        unit: "м/с",
        unitRequired: true,
      };
      return [block];
    },
  },
  {
    id: "phys_lab_table",
    kind: "group",
    subject: "Физика",
    label: "Лабораторная: таблица измерений",
    description: "Таблица с полями ответа для результатов измерений + вывод.",
    icon: Zap,
    outline: ["Таблица · поля ответа", "Вывод"],
    triggers: ["лабораторная работа", "запишите результаты измерений", "таблица измерений"],
    build: () => [
      tableFillQuestion("<p>Заполните таблицу результатами измерений</p>", [
        ["№", "Величина", "Значение"],
        ["1", "", null],
        ["2", "", null],
      ]),
      question("open_answer", "<p>Сформулируйте вывод по результатам измерений</p>"),
    ],
  },
  {
    id: "phys_graph_reading",
    kind: "group",
    subject: "Физика",
    label: "Чтение графика",
    description: "Изображение графика + два вопроса по нему.",
    icon: Zap,
    outline: ["График", "Вопрос 1", "Вопрос 2"],
    triggers: ["по графику определите", "на графике изображена зависимость", "проанализируйте график"],
    build: () => [
      image("График зависимости"),
      question("single_choice", "<p>Что происходит на графике в начале процесса?</p>"),
      question("numeric_input", "<p>Определите значение по графику</p>"),
    ],
  },
  {
    id: "phys_formula_match",
    kind: "group",
    subject: "Физика",
    label: "Формула — что выражает",
    description: "Сопоставьте формулы с физическими величинами.",
    icon: Zap,
    outline: ["Сопоставление · 3 пары"],
    triggers: ["что выражает формула", "физическая величина", "сопоставьте формулу"],
    build: () => [
      matchingQuestion("<p>Сопоставьте формулу и величину</p>", [
        ["v = s/t", "скорость"],
        ["F = ma", "сила"],
        ["p = mv", "импульс"],
      ]),
    ],
  },
  {
    id: "phys_why_question",
    kind: "block",
    subject: "Физика",
    label: "Качественный вопрос «почему»",
    description: "Развёрнутый ответ с рубрикой оценки объяснения.",
    icon: Zap,
    outline: ["Развёрнутый ответ · рубрика"],
    triggers: ["объясните почему", "с чем связано явление", "качественная задача"],
    build: () => {
      const block = createQuestionBlock("open_answer", crypto.randomUUID());
      block.prompt = { html: "<p>Объясните, почему происходит это явление</p>" };
      block.interaction = {
        type: "open_answer",
        maxLength: 800,
        allowAttachments: false,
        rubric: [
          { id: crypto.randomUUID(), label: "Верное объяснение причины", points: 1 },
          { id: crypto.randomUUID(), label: "Использованы физические термины", points: 1 },
        ],
      };
      return [block];
    },
  },
  {
    id: "phys_circuit_scheme",
    kind: "group",
    subject: "Физика",
    label: "Схема электрической цепи",
    description: "Изображение схемы + развёрнутый вопрос об элементах цепи.",
    icon: Zap,
    outline: ["Схема", "Развёрнутый ответ"],
    triggers: ["электрическая цепь", "соберите схему", "элементы цепи"],
    build: () => [image("Схема цепи"), question("open_answer", "<p>Опишите, как соединены элементы цепи</p>")],
  },

  // ─── Химия ───────────────────────────────────────────────────────────────
  {
    id: "chem_classify",
    kind: "block",
    subject: "Химия",
    label: "Классификация веществ",
    description: "Разложите вещества на металлы и неметаллы — перетаскивание по корзинам.",
    icon: FlaskConical,
    outline: ["Категоризация · 2 группы"],
    triggers: ["классифицируйте вещества", "отметьте металлы", "распределите вещества"],
    build: () => [
      categorizeQuestion("<p>Разложите вещества по группам</p>", [
        ["Металлы", ["натрий", "железо", "медь"]],
        ["Неметаллы", ["кислород", "водород"]],
      ]),
    ],
  },
  {
    id: "chem_chain",
    kind: "group",
    subject: "Химия",
    label: "Цепочка превращений",
    description: "Вступление и три вопроса на продукты последовательных реакций.",
    icon: FlaskConical,
    outline: ["Схема цепочки", "3 × продукт реакции"],
    triggers: ["цепочка превращений", "осуществите превращения", "составьте цепочку реакций"],
    build: () => [
      richText("<p>Схема цепочки: A → B → C → D</p>"),
      question("text_input", "<p>Продукт реакции 1 (B)</p>"),
      question("text_input", "<p>Продукт реакции 2 (C)</p>"),
      question("text_input", "<p>Продукт реакции 3 (D)</p>"),
    ],
  },
  {
    id: "chem_calc_problem",
    kind: "block",
    subject: "Химия",
    label: "Расчётная задача по уравнению",
    description: "Числовой ответ с относительным допуском под расчёт по уравнению реакции.",
    icon: FlaskConical,
    outline: ["Числовой ответ · допуск"],
    triggers: ["вычислите массу", "рассчитайте количество вещества", "по уравнению реакции найдите"],
    build: () => {
      const block = createQuestionBlock("numeric_input", crypto.randomUUID());
      block.prompt = { html: "<p>Вычислите по уравнению реакции</p>" };
      block.interaction = { type: "numeric_input", value: 0, tolerance: { kind: "relative", value: 0.02 }, unit: "г", unitRequired: false };
      return [block];
    },
  },
  {
    id: "chem_balance_eq",
    kind: "group",
    subject: "Химия",
    label: "Уравняй реакцию",
    description: "Уравнение реакции без коэффициентов — впишите коэффициенты через пробел.",
    icon: FlaskConical,
    outline: ["Уравнение", "Коэффициенты"],
    triggers: ["уравняйте реакцию", "расставьте коэффициенты", "уравнение реакции"],
    build: () => [
      richText("<p>Уравнение: __Fe + __O₂ → __Fe₂O₃</p>"),
      question("text_input", "<p>Впишите коэффициенты через пробел, в порядке слева направо</p>"),
    ],
  },
  {
    id: "chem_periodic_table",
    kind: "group",
    subject: "Химия",
    label: "Элемент — свойство",
    description: "Сопоставьте химический элемент с его свойством.",
    icon: FlaskConical,
    outline: ["Сопоставление · 3 пары"],
    triggers: ["свойства элемента", "положение в таблице менделеева", "сопоставьте элемент"],
    build: () => [
      matchingQuestion("<p>Сопоставьте элемент и его свойство</p>", [
        ["Натрий", "Щелочной металл"],
        ["Хлор", "Галоген"],
        ["Гелий", "Инертный газ"],
      ]),
    ],
  },
  {
    id: "chem_safety",
    kind: "group",
    subject: "Химия",
    label: "Техника безопасности",
    description: "Изображение ситуации в лаборатории + вопрос о нарушении.",
    icon: FlaskConical,
    outline: ["Изображение", "Выбор нарушения"],
    triggers: ["техника безопасности", "что нарушено", "правила работы в лаборатории"],
    build: () => [
      image("Ситуация в лаборатории"),
      mcQuestion(
        "<p>Какое правило техники безопасности нарушено на изображении?</p>",
        ["Вариант 1", "Вариант 2", "Вариант 3", "Вариант 4"],
        0,
      ),
    ],
  },

  // ─── Биология ────────────────────────────────────────────────────────────
  {
    id: "bio_label_scheme",
    kind: "group",
    subject: "Биология",
    label: "Подпиши схему",
    description: "Изображение схемы (клетка, цветок, скелет) + подписи частей.",
    icon: Leaf,
    outline: ["Схема", "3 × подпись"],
    triggers: ["подпишите схему", "назовите части", "строение клетки"],
    build: () => [
      image("Схема строения"),
      question("text_input", "<p>Часть 1</p>"),
      question("text_input", "<p>Часть 2</p>"),
      question("text_input", "<p>Часть 3</p>"),
    ],
  },
  {
    id: "bio_classify_organisms",
    kind: "block",
    subject: "Биология",
    label: "Классификация организмов",
    description: "Разложите организмы на позвоночных и беспозвоночных — перетаскивание по корзинам.",
    icon: Leaf,
    outline: ["Категоризация · 2 группы"],
    triggers: ["классифицируйте организмы", "отметьте позвоночных", "распредели по группам"],
    build: () => [
      categorizeQuestion("<p>Разложите организмов по группам</p>", [
        ["Позвоночные", ["лягушка", "окунь"]],
        ["Беспозвоночные", ["дождевой червь", "медуза", "улитка"]],
      ]),
    ],
  },
  {
    id: "bio_process_order",
    kind: "group",
    subject: "Биология",
    label: "Последовательность процесса",
    description: "Расставьте стадии биологического процесса по порядку.",
    icon: Leaf,
    outline: ["Упорядочивание · 4 стадии"],
    triggers: ["стадии развития", "последовательность процесса", "фазы деления клетки"],
    build: () => [
      orderingQuestion("<p>Расставьте стадии процесса в правильном порядке</p>", ["Стадия 1", "Стадия 2", "Стадия 3", "Стадия 4"]),
    ],
  },
  {
    id: "bio_compare_table",
    kind: "group",
    subject: "Биология",
    label: "Сравнительная таблица",
    description: "Таблица с полями ответа для сравнения двух объектов + вывод.",
    icon: Leaf,
    outline: ["Таблица · поля ответа", "Вывод"],
    triggers: ["сравните", "сравнительная характеристика", "заполните таблицу сравнения"],
    build: () => [
      tableFillQuestion("<p>Заполните таблицу сравнения</p>", [
        ["Признак", "Объект 1", "Объект 2"],
        ["Признак 1", null, null],
      ]),
      question("open_answer", "<p>Сформулируйте вывод из сравнения</p>"),
    ],
  },
  {
    id: "bio_identify_photo",
    kind: "group",
    subject: "Биология",
    label: "Определи по фотографии",
    description: "Изображение организма + вопрос с выбором варианта.",
    icon: Leaf,
    outline: ["Фотография", "Выбор варианта"],
    triggers: ["определите по фотографии", "что изображено на рисунке", "узнайте организм"],
    build: () => [
      image("Фотография организма"),
      mcQuestion("<p>Что изображено на фотографии?</p>", ["Вариант 1", "Вариант 2", "Вариант 3", "Вариант 4"], 0),
    ],
  },

  // ─── География ───────────────────────────────────────────────────────────
  {
    id: "geo_contour_map",
    kind: "group",
    subject: "География",
    label: "Контурная карта",
    description: "Изображение контурной карты + подпись географического объекта.",
    icon: Map,
    outline: ["Карта", "Подпись объекта"],
    triggers: ["на контурной карте", "покажите на карте", "отметьте объект на карте"],
    build: () => [image("Контурная карта"), question("text_input", "<p>Назовите отмеченный объект</p>")],
  },
  {
    id: "geo_capitals",
    kind: "group",
    subject: "География",
    label: "Страна — столица",
    description: "Сопоставьте страны с их столицами.",
    icon: Map,
    outline: ["Сопоставление · 5 пар"],
    triggers: ["страна и столица", "сопоставьте страну", "назовите столицу"],
    build: () => [
      matchingQuestion("<p>Сопоставьте страну и столицу</p>", [
        ["Страна 1", "Столица 1"],
        ["Страна 2", "Столица 2"],
        ["Страна 3", "Столица 3"],
        ["Страна 4", "Столица 4"],
        ["Страна 5", "Столица 5"],
      ]),
    ],
  },
  {
    id: "geo_coordinates",
    kind: "group",
    subject: "География",
    label: "Координаты точки",
    description: "Два числовых вопроса — широта и долгота с допуском.",
    icon: Map,
    outline: ["Широта", "Долгота"],
    triggers: ["определите координаты", "широта и долгота", "географические координаты"],
    build: () => {
      const lat = createQuestionBlock("numeric_input", crypto.randomUUID());
      lat.prompt = { html: "<p>Широта точки</p>" };
      lat.interaction = { type: "numeric_input", value: 0, tolerance: { kind: "absolute", value: 1 }, unit: "°", unitRequired: false };
      const lon = createQuestionBlock("numeric_input", crypto.randomUUID());
      lon.prompt = { html: "<p>Долгота точки</p>" };
      lon.interaction = { type: "numeric_input", value: 0, tolerance: { kind: "absolute", value: 1 }, unit: "°", unitRequired: false };
      return [image("Карта с отмеченной точкой"), lat, lon];
    },
  },
  {
    id: "geo_climatogram",
    kind: "group",
    subject: "География",
    label: "Чтение климатограммы",
    description: "Изображение климатограммы + два вопроса по ней.",
    icon: Map,
    outline: ["Климатограмма", "Вопрос 1", "Вопрос 2"],
    triggers: ["по климатограмме определите", "проанализируйте климатограмму"],
    build: () => [
      image("Климатограмма"),
      question("single_choice", "<p>Какой месяц самый тёплый?</p>"),
      question("numeric_input", "<p>Какое среднее количество осадков?</p>"),
    ],
  },
  {
    id: "geo_natural_zones",
    kind: "block",
    subject: "География",
    label: "Природные зоны",
    description: "Разложите виды растений/животных по природным зонам — перетаскивание по корзинам.",
    icon: Map,
    outline: ["Категоризация · 2 группы"],
    triggers: ["природная зона", "признаки природной зоны", "характерно для зоны"],
    build: () => [
      categorizeQuestion("<p>Разложите по природным зонам</p>", [
        ["Тундра", ["Группа 1"]],
        ["Пустыня", ["Группа 2"]],
      ]),
    ],
  },

  // ─── История и обществознание ───────────────────────────────────────────
  {
    id: "hist_timeline",
    kind: "group",
    subject: "История и обществознание",
    label: "Лента времени",
    description: "Расставьте исторические события в хронологическом порядке.",
    icon: Landmark,
    outline: ["Упорядочивание · 5 событий"],
    triggers: ["хронологический порядок", "расставьте события", "лента времени"],
    build: () => [
      orderingQuestion("<p>Расставьте события в хронологическом порядке</p>", [
        "Событие 1",
        "Событие 2",
        "Событие 3",
        "Событие 4",
        "Событие 5",
      ]),
    ],
  },
  {
    id: "hist_date_event",
    kind: "group",
    subject: "История и обществознание",
    label: "Дата — событие",
    description: "Сопоставьте исторические даты с событиями.",
    icon: Landmark,
    outline: ["Сопоставление · 5 пар"],
    triggers: ["дата события", "сопоставьте дату", "что произошло в"],
    build: () => [
      matchingQuestion("<p>Сопоставьте дату и событие</p>", [
        ["Дата 1", "Событие 1"],
        ["Дата 2", "Событие 2"],
        ["Дата 3", "Событие 3"],
        ["Дата 4", "Событие 4"],
        ["Дата 5", "Событие 5"],
      ]),
    ],
  },
  {
    id: "hist_source_work",
    kind: "group",
    subject: "История и обществознание",
    label: "Работа с историческим источником",
    description: "Фрагмент источника + вопросы разных типов.",
    icon: Landmark,
    outline: ["Фрагмент", "3 × выбор", "Развёрнутый ответ"],
    triggers: ["прочитайте фрагмент источника", "по данному документу", "исторический источник"],
    build: () => [
      richText("<h3>Фрагмент источника</h3><p>Текст документа.</p>"),
      question("single_choice", "<p>Вопрос 1 по источнику</p>"),
      question("single_choice", "<p>Вопрос 2 по источнику</p>"),
      question("single_choice", "<p>Вопрос 3 по источнику</p>"),
      question("open_answer", "<p>Как этот документ характеризует эпоху?</p>"),
    ],
  },
  {
    id: "hist_recognize_person",
    kind: "group",
    subject: "История и обществознание",
    label: "Узнай личность по портрету",
    description: "Изображение портрета + вопрос с выбором варианта.",
    icon: Landmark,
    outline: ["Портрет", "Выбор варианта"],
    triggers: ["узнайте по портрету", "кто изображён", "историческая личность"],
    build: () => [
      image("Портрет исторической личности"),
      mcQuestion("<p>Кто изображён на портрете?</p>", ["Вариант 1", "Вариант 2", "Вариант 3", "Вариант 4"], 0),
    ],
  },
  {
    id: "hist_battle_map",
    kind: "group",
    subject: "История и обществознание",
    label: "Карта сражения / территории",
    description: "Изображение карты + вопрос о территории или сражении.",
    icon: Landmark,
    outline: ["Карта", "Текстовый ответ"],
    triggers: ["на карте сражения", "территория государства", "по исторической карте"],
    build: () => [image("Историческая карта"), question("text_input", "<p>Назовите отмеченный объект/сражение</p>")],
  },
  {
    id: "hist_legal_case",
    kind: "group",
    subject: "История и обществознание",
    label: "Правовой кейс",
    description: "Описание ситуации + развёрнутый ответ с рубрикой.",
    icon: Landmark,
    outline: ["Кейс", "Развёрнутый ответ"],
    triggers: ["правовая ситуация", "разберите ситуацию", "с точки зрения закона"],
    build: () => [
      richText("<h3>Ситуация</h3><p>Описание правовой ситуации.</p>"),
      question("open_answer", "<p>Как должна быть разрешена эта ситуация с точки зрения закона?</p>"),
    ],
  },
  {
    id: "hist_concept_features",
    kind: "block",
    subject: "История и обществознание",
    label: "Признаки понятия",
    description: "Отберите верные признаки указанного понятия.",
    icon: Landmark,
    outline: ["Множественный выбор"],
    triggers: ["признаки понятия", "отберите верные признаки", "что характеризует понятие"],
    build: () => [question("multiple_choice", "<p>Отметьте признаки, характерные для понятия</p>")],
  },

  // ─── Информатика ─────────────────────────────────────────────────────────
  {
    id: "inf_program_output",
    kind: "group",
    subject: "Информатика",
    label: "Что выведет программа",
    description: "Фрагмент кода + текстовый ответ с результатом выполнения.",
    icon: Code2,
    outline: ["Код", "Текстовый ответ"],
    triggers: ["что выведет программа", "определите результат работы", "трассировка кода"],
    build: () => [
      richText("<pre>for i in range(3):\n    print(i)</pre>"),
      question("text_input", "<p>Что выведет программа?</p>"),
    ],
  },
  {
    id: "inf_code_gaps",
    kind: "group",
    subject: "Информатика",
    label: "Код с пропусками",
    description: "Фрагмент алгоритма с пропущенными частями — впишите их.",
    icon: Code2,
    outline: ["Код", "2 × пропуск"],
    triggers: ["дополните код", "впишите пропущенную часть кода", "заполните алгоритм"],
    build: () => [
      richText("<p>Дополните фрагмент кода.</p>"),
      question("text_input", "<p>Пропуск 1</p>"),
      question("text_input", "<p>Пропуск 2</p>"),
    ],
  },
  {
    id: "inf_algorithm_trace",
    kind: "group",
    subject: "Информатика",
    label: "Трассировка алгоритма",
    description: "Таблица с полями ответа для пошаговой трассировки + итог.",
    icon: Code2,
    outline: ["Таблица · поля ответа", "Итог"],
    triggers: ["трассировка алгоритма", "проследите выполнение", "заполните таблицу трассировки"],
    build: () => [
      tableFillQuestion("<p>Заполните таблицу трассировки</p>", [
        ["Шаг", "Переменная", "Значение"],
        ["1", "", null],
        ["2", "", null],
      ]),
      question("text_input", "<p>Итоговое значение переменной</p>"),
    ],
  },
  {
    id: "inf_algorithm_order",
    kind: "group",
    subject: "Информатика",
    label: "Порядок блоков алгоритма",
    description: "Расставьте шаги алгоритма в правильном порядке.",
    icon: Code2,
    outline: ["Упорядочивание · 4 шага"],
    triggers: ["порядок действий алгоритма", "расставьте блоки алгоритма", "восстановите алгоритм"],
    build: () => [
      orderingQuestion("<p>Расставьте шаги алгоритма по порядку</p>", ["Шаг 1", "Шаг 2", "Шаг 3", "Шаг 4"]),
    ],
  },
  {
    id: "inf_number_system",
    kind: "block",
    subject: "Информатика",
    label: "Перевод систем счисления",
    description: "Числовой ответ под перевод числа в другую систему счисления.",
    icon: Code2,
    outline: ["Числовой ответ"],
    triggers: ["переведите число в", "двоичная система", "шестнадцатеричная система"],
    build: () => {
      const block = createQuestionBlock("numeric_input", crypto.randomUUID());
      block.prompt = { html: "<p>Переведите число в указанную систему счисления</p>" };
      return [block];
    },
  },
  {
    id: "inf_truth_table",
    kind: "group",
    subject: "Информатика",
    label: "Таблица истинности",
    description: "Заготовка таблицы истинности + вопрос о значении выражения.",
    icon: Code2,
    outline: ["Таблица", "Множественный выбор"],
    triggers: ["таблица истинности", "логическое выражение", "заполните таблицу истинности"],
    build: () => [
      table([
        ["A", "B", "A ∧ B"],
        ["0", "0", ""],
        ["0", "1", ""],
        ["1", "0", ""],
        ["1", "1", ""],
      ]),
      question("multiple_choice", "<p>При каких значениях A и B выражение истинно?</p>"),
    ],
  },

  // ─── Музыка, ИЗО, ОБЖ ────────────────────────────────────────────────────
  {
    id: "art_audio_question",
    kind: "group",
    subject: "Музыка, ИЗО, ОБЖ",
    label: "Музыкальный фрагмент",
    description: "Аудиофрагмент + вопрос об инструменте/эпохе/стиле.",
    icon: Palette,
    outline: ["Аудио", "Выбор варианта"],
    triggers: ["прослушайте фрагмент", "определите инструмент", "какому композитору принадлежит"],
    build: () => [
      audioBlock("Музыкальный фрагмент"),
      mcQuestion("<p>Что вы услышали?</p>", ["Вариант 1", "Вариант 2", "Вариант 3", "Вариант 4"], 0),
    ],
  },
  {
    id: "art_reproduction_analysis",
    kind: "group",
    subject: "Музыка, ИЗО, ОБЖ",
    label: "Анализ репродукции",
    description: "Изображение картины + развёрнутый вопрос об анализе.",
    icon: Palette,
    outline: ["Репродукция", "Развёрнутый ответ"],
    triggers: ["проанализируйте картину", "опишите репродукцию", "что изображено на картине"],
    build: () => [image("Репродукция"), question("open_answer", "<p>Опишите и проанализируйте изображение</p>")],
  },
  {
    id: "art_recognize_style",
    kind: "group",
    subject: "Музыка, ИЗО, ОБЖ",
    label: "Узнай стиль или эпоху",
    description: "Изображение + вопрос с выбором художественного стиля.",
    icon: Palette,
    outline: ["Изображение", "Выбор стиля"],
    triggers: ["определите стиль", "к какой эпохе относится", "художественное направление"],
    build: () => [
      image("Изображение произведения"),
      mcQuestion("<p>К какому стилю/эпохе относится изображение?</p>", ["Вариант 1", "Вариант 2", "Вариант 3", "Вариант 4"], 0),
    ],
  },
  {
    id: "safety_algorithm",
    kind: "group",
    subject: "Музыка, ИЗО, ОБЖ",
    label: "Алгоритм действий в ЧС",
    description: "Расставьте шаги действий при чрезвычайной ситуации по порядку.",
    icon: Palette,
    outline: ["Упорядочивание · 4 шага"],
    triggers: ["действия при чс", "порядок действий при пожаре", "алгоритм эвакуации"],
    build: () => [
      orderingQuestion("<p>Расставьте действия по порядку</p>", ["Шаг 1", "Шаг 2", "Шаг 3", "Шаг 4"]),
    ],
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

/**
 * Метки «черновик только что создан, метаданные ещё не заданы» (Э13).
 * `schemaVersion` требует непустые `subject`/`grades`, поэтому пустой
 * черновик заводится с заглушками; редактор просит указать настоящие
 * название и класс при первом «Сохранить» и блокирует до этого
 * отправку на ревью/публикацию.
 */
export const DRAFT_PLACEHOLDER = { title: "Черновик материала", subject: "—", grade: 1 } as const;

export function isPlaceholderMeta(meta: { title: string; subject: string }): boolean {
  return (
    meta.title.trim() === DRAFT_PLACEHOLDER.title && meta.subject.trim() === DRAFT_PLACEHOLDER.subject
  );
}

/** Мгновенно создаваемый пустой черновик — метаданные методист укажет позже (Э13). */
export function buildPlaceholderDraft(): Material {
  return buildBlankMaterial({
    title: DRAFT_PLACEHOLDER.title,
    subject: DRAFT_PLACEHOLDER.subject,
    grades: [DRAFT_PLACEHOLDER.grade],
  });
}

/** Пустой валидный `Material` (Э13, вкладка «Редактор»). */
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
    settings: { shuffleBlocks: false, showFeedback: "after_submit", attemptsAllowed: 1, layout: "slides" },
    blocks: [],
    groups: [],
  };
}
