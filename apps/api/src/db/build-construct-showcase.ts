/**
 * Витрина конструкций (Э13, доп. 4 — запрос пользователя «сделай материал,
 * где я смогу просмотреть все конструкции… заполни его нормально теорией
 * и практикой, используй ВСЕ конструкции»). Один материал, использующий
 * КАЖДУЮ конструкцию из `MATERIAL_CONSTRUCTS`
 * (apps/web/src/features/materials/material-templates.ts) с настоящим
 * предметным наполнением — не заготовки-плейсхолдеры, которые
 * инструктирует конструктор в редакторе, а реальные факты/задачи/ответы.
 *
 * Не часть рантайма — ручной инструмент для наполнения, как
 * `seed-material.ts` рядом (структуру/`Material` намеренно строим тут же
 * плоскими объектами, а не импортом `MATERIAL_CONSTRUCTS` из web: конструкции
 * там дают ЗАГОТОВКИ, здесь нужен готовый контент; `ALL_CONSTRUCT_IDS` ниже
 * переписан вручную с id конструкций на момент написания и служит только
 * проверкой полноты — `assertCoverage()` в конце бросит исключение, если
 * какая-то конструкция осталась без реального контента).
 *
 * Запуск (без БД, только пишет JSON):
 *
 *   pnpm --filter @school/api exec tsx src/db/build-construct-showcase.ts
 *
 * Дальше заводится в БД уже существующим `seed-material.ts`:
 *
 *   pnpm --filter @school/api run seed:material -- \
 *     ../../docs/materials/construct-showcase.json --status published
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  materialSchema,
  validateMaterialContent,
  type Material,
  type MaterialBlock,
  type QuestionInteraction,
} from "@school/shared";

const uid = () => crypto.randomUUID();

// ─── Хелперы контентных блоков ──────────────────────────────────────────

function richText(html: string): MaterialBlock {
  return { type: "rich_text", id: uid(), html };
}
function callout(variant: "note" | "warning" | "example", html: string): MaterialBlock {
  return { type: "callout", id: uid(), variant, html };
}
function spoiler(title: string, html: string): MaterialBlock {
  return { type: "spoiler", id: uid(), title, html };
}
function formula(latex: string): MaterialBlock {
  return { type: "formula", id: uid(), latex };
}
function table(rows: string[][]): MaterialBlock {
  return { type: "table", id: uid(), rows };
}
/**
 * Заглушка вместо реального изображения/аудио — в этой среде нет
 * медиатеки для загрузки файлов (StorageAdapter/БД недоступны здесь;
 * `imageBlockSchema`/`audioBlockSchema` требуют непустой `assetId`, взять
 * его неоткуда). Методист при желании заменит на реальный файл через
 * пикер медиатеки — сама конструкция и её текстовое содержимое реальны.
 */
function mediaPlaceholder(kind: "image" | "audio", description: string): MaterialBlock {
  const icon = kind === "image" ? "🖼️" : "🎧";
  const noun = kind === "image" ? "изображение" : "аудиофрагмент";
  return callout(
    "note",
    `<p>${icon} <em>Здесь будет ${noun}: ${description}. Замените на файл из медиатеки.</em></p>`,
  );
}

function questionBlock(promptHtml: string, interaction: QuestionInteraction, points = 1): MaterialBlock {
  return { type: "question", id: uid(), prompt: { html: promptHtml }, points, interaction };
}

// ─── Хелперы типов взаимодействия ───────────────────────────────────────

function singleChoice(options: [string, boolean][]): QuestionInteraction {
  return { type: "single_choice", shuffle: false, options: options.map(([html, correct]) => ({ id: uid(), html, correct })) };
}
function multipleChoice(options: [string, boolean][]): QuestionInteraction {
  return { type: "multiple_choice", shuffle: false, options: options.map(([html, correct]) => ({ id: uid(), html, correct })) };
}
function trueFalse(correct: boolean): QuestionInteraction {
  return { type: "true_false", correct };
}
function textInput(
  answers: string[],
  opts: Partial<{ caseSensitive: boolean; trimWhitespace: boolean; typoTolerance: number }> = {},
): QuestionInteraction {
  return {
    type: "text_input",
    answers: answers.map((value) => ({ value, match: "normalized" as const })),
    caseSensitive: opts.caseSensitive ?? false,
    trimWhitespace: opts.trimWhitespace ?? true,
    typoTolerance: opts.typoTolerance ?? 1,
  };
}
function numericInput(
  value: number,
  tolerance: { kind: "absolute" | "relative" | "percent"; value: number },
  unit?: string,
  unitRequired = false,
): QuestionInteraction {
  return { type: "numeric_input", value, tolerance, unit, unitRequired };
}
function openAnswer(maxLength: number, rubric: [string, number][]): QuestionInteraction {
  return {
    type: "open_answer",
    maxLength,
    allowAttachments: false,
    rubric: rubric.map(([label, points]) => ({ id: uid(), label, points })),
  };
}
function clozeDropdown(template: string, gaps: Record<string, { options: string[]; correct: string }>): QuestionInteraction {
  return { type: "cloze_dropdown", template, gaps };
}
function matching(pairs: [string, string][], scoring: "all_or_nothing" | "partial" = "all_or_nothing"): QuestionInteraction {
  const left = pairs.map(([l]) => ({ id: uid(), html: l }));
  const right = pairs.map(([, r]) => ({ id: uid(), html: r }));
  return {
    type: "matching",
    left,
    right,
    pairs: left.map((l, i) => [l.id, right[i]!.id] as [string, string]),
    scoring,
    distractors: [],
  };
}
function ordering(itemsHtml: string[]): QuestionInteraction {
  return { type: "ordering", items: itemsHtml.map((html) => ({ id: uid(), html })) };
}
function categorize(groups: [string, string[]][]): QuestionInteraction {
  const categories = groups.map(([label]) => ({ id: uid(), label }));
  const items = groups.flatMap(([, labels], i) => labels.map((html) => ({ id: uid(), html, categoryId: categories[i]!.id })));
  return { type: "categorize", shuffle: true, categories, items };
}
function highlightText(words: [string, boolean][]): QuestionInteraction {
  return { type: "highlight_text", tokens: words.map(([text, correct]) => ({ id: uid(), text, correct })) };
}
function tableFill(rows: (string | { answer: string })[][]): QuestionInteraction {
  return {
    type: "table_fill",
    rows: rows.map((row) =>
      row.map((cell) =>
        typeof cell === "string"
          ? { kind: "static" as const, text: cell }
          : {
              kind: "input" as const,
              id: uid(),
              answers: [{ value: cell.answer, match: "normalized" as const }],
              caseSensitive: false,
              trimWhitespace: true,
              typoTolerance: 1,
            },
      ),
    ),
  };
}

// ─── Проверка полноты (все конструкции на момент написания скрипта) ────

const ALL_CONSTRUCT_IDS = [
  // Общее
  "problem_walkthrough", "quiz_block", "spelling_dictation", "definition_block",
  "paragraph_with_check", "definition_callout", "theorem_callout", "example_callout",
  "mc4", "numeric_tolerance",
  // Русский язык
  "ru_missing_letter", "ru_punctuation", "ru_stress", "ru_word_parts",
  "ru_syntax_parse", "ru_fix_error", "ru_text_work", "ru_parts_of_speech",
  // Литература
  "lit_quote_analysis", "lit_author_match", "lit_hero_work", "lit_timeline",
  "lit_expressive_means", "lit_essay",
  // Английский язык
  "en_vocab_match", "en_listening", "en_grammar_gaps", "en_word_order",
  "en_dialogue_gaps", "en_word_formation",
  // Математика
  "math_equation", "math_formula_chain", "math_proof_steps", "math_figure_problem",
  "math_find_error", "math_mental_math",
  // Физика
  "phys_units_problem", "phys_lab_table", "phys_graph_reading", "phys_formula_match",
  "phys_why_question", "phys_circuit_scheme",
  // Химия
  "chem_classify", "chem_chain", "chem_calc_problem", "chem_balance_eq",
  "chem_periodic_table", "chem_safety",
  // Биология
  "bio_label_scheme", "bio_classify_organisms", "bio_process_order",
  "bio_compare_table", "bio_identify_photo",
  // География
  "geo_contour_map", "geo_capitals", "geo_coordinates", "geo_climatogram", "geo_natural_zones",
  // История и обществознание
  "hist_timeline", "hist_date_event", "hist_source_work", "hist_recognize_person",
  "hist_battle_map", "hist_legal_case", "hist_concept_features",
  // Информатика
  "inf_program_output", "inf_code_gaps", "inf_algorithm_trace", "inf_algorithm_order",
  "inf_number_system", "inf_truth_table",
  // Музыка, ИЗО, ОБЖ
  "art_audio_question", "art_reproduction_analysis", "art_recognize_style", "safety_algorithm",
] as const;

interface ShowcaseItem {
  id: (typeof ALL_CONSTRUCT_IDS)[number];
  label: string;
  blocks: MaterialBlock[];
}
interface ShowcaseSection {
  subject: string;
  items: ShowcaseItem[];
}

function item(id: ShowcaseItem["id"], label: string, blocks: MaterialBlock[]): ShowcaseItem {
  return { id, label, blocks };
}

// ─── Содержимое по разделам (реальные факты/задачи/ответы) ─────────────

const SECTIONS: ShowcaseSection[] = [
  {
    subject: "Общее",
    items: [
      item("problem_walkthrough", "Разбор задачи", [
        richText("<h2>Разбор задачи</h2><p>Периметр прямоугольника со сторонами 5 см и 3 см.</p>"),
        formula("P = 2(a + b)"),
        callout("example", "<p><strong>Шаг 1.</strong> Подставим значения: P = 2(5 + 3).</p>"),
        callout("example", "<p><strong>Шаг 2.</strong> Посчитаем: P = 2 · 8 = 16.</p>"),
        questionBlock("<p>Чему равен периметр (в см)?</p>", numericInput(16, { kind: "absolute", value: 0.01 })),
      ]),
      item("quiz_block", "Блок проверки", [
        richText("<p>Ответьте на вопросы ниже.</p>"),
        questionBlock(
          "<p>Сколько дней в високосном году?</p>",
          singleChoice([["365", false], ["366", true], ["364", false], ["367", false]]),
        ),
        questionBlock(
          "<p>Столица России?</p>",
          singleChoice([["Санкт-Петербург", false], ["Москва", true], ["Новосибирск", false], ["Казань", false]]),
        ),
        questionBlock(
          "<p>Сколько будет 7 × 8?</p>",
          singleChoice([["54", false], ["64", false], ["56", true], ["48", false]]),
        ),
      ]),
      item("spelling_dictation", "Словарный диктант", [
        richText("<p>Учитель диктует слово — впишите его без ошибок.</p>"),
        questionBlock("<p>Слово 1</p>", textInput(["происшествие"])),
        questionBlock("<p>Слово 2</p>", textInput(["искусство"])),
        questionBlock("<p>Слово 3</p>", textInput(["аллея"])),
        questionBlock("<p>Слово 4</p>", textInput(["коллекция"])),
        questionBlock("<p>Слово 5</p>", textInput(["профессия"])),
      ]),
      item("definition_block", "Определение и теорема", [
        callout("note", "<p><strong>Определение.</strong> Прямоугольный треугольник — треугольник, один из углов которого равен 90°.</p>"),
        callout("warning", "<p><strong>Теорема Пифагора.</strong> Квадрат гипотенузы равен сумме квадратов катетов: c² = a² + b².</p>"),
        callout("example", "<p><strong>Пример.</strong> Если a = 3, b = 4, то c² = 9 + 16 = 25, c = 5.</p>"),
      ]),
      item("paragraph_with_check", "Параграф с проверкой", [
        richText("<h2>Агрегатные состояния воды</h2><p>Вода может находиться в трёх агрегатных состояниях: твёрдом (лёд), жидком (вода) и газообразном (пар).</p>"),
        questionBlock(
          "<p>В каком состоянии вода в виде пара?</p>",
          singleChoice([["Твёрдом", false], ["Жидком", false], ["Газообразном", true]]),
        ),
        questionBlock("<p>Лёд — это твёрдое состояние воды.</p>", trueFalse(true)),
      ]),
      item("definition_callout", "Врезка «Определение»", [
        callout("note", "<p><strong>Определение.</strong> Простое число — натуральное число больше 1, которое делится только на 1 и на само себя.</p>"),
      ]),
      item("theorem_callout", "Врезка «Теорема»", [
        callout("warning", "<p><strong>Теорема.</strong> Сумма углов любого треугольника равна 180°.</p>"),
      ]),
      item("example_callout", "Врезка «Пример»", [
        callout("example", "<p><strong>Пример.</strong> 2, 3, 5, 7, 11 — первые пять простых чисел.</p>"),
      ]),
      item("mc4", "Вопрос: выбор из 4", [
        questionBlock("<p>Сколько будет 15 + 27?</p>", singleChoice([["42", true], ["52", false], ["32", false], ["41", false]])),
      ]),
      item("numeric_tolerance", "Числовой ответ с допуском", [
        questionBlock(
          "<p>Вычислите площадь круга радиусом 2 см (π ≈ 3.14)</p>",
          numericInput(12.56, { kind: "relative", value: 0.01 }, "см²"),
        ),
      ]),
    ],
  },

  {
    subject: "Русский язык",
    items: [
      item("ru_missing_letter", "Вставь пропущенную букву", [
        richText("<p>Вставьте пропущенную букву и впишите слово целиком.</p>"),
        questionBlock("<p>1. б_гать</p>", textInput(["бегать"])),
        questionBlock("<p>2. д_ждь</p>", textInput(["дождь"])),
        questionBlock("<p>3. к_ртина</p>", textInput(["картина"])),
        questionBlock("<p>4. с_довник</p>", textInput(["садовник"])),
        questionBlock("<p>5. х_роший</p>", textInput(["хороший"])),
        questionBlock("<p>6. м_шина</p>", textInput(["машина"])),
        questionBlock("<p>7. к_рабль</p>", textInput(["корабль"])),
        questionBlock("<p>8. с_бака</p>", textInput(["собака"])),
      ]),
      item("ru_punctuation", "Расставь знаки препинания", [
        richText("<p>Выберите знак препинания, который нужно поставить на месте пропуска.</p>"),
        questionBlock(
          "<p>Вставьте знак препинания</p>",
          clozeDropdown("Когда стемнело{{g1}} мы зажгли свечи.", { g1: { options: [",", "—", "нет знака"], correct: "," } }),
        ),
      ]),
      item("ru_stress", "Орфоэпическая разминка", [
        richText("<p>Отметьте слово с верно поставленным ударением (норма современного русского языка).</p>"),
        questionBlock("<p>1. Как правильно?</p>", singleChoice([["тОрты", true], ["торТЫ", false], ["ТОРты", false], ["торты (без ударения)", false]])),
        questionBlock("<p>2. Как правильно?</p>", singleChoice([["звонИт", true], ["звОнит", false], ["звоНИТ", false], ["ЗВОнит", false]])),
        questionBlock("<p>3. Как правильно?</p>", singleChoice([["срЕдства", true], ["средствА", false], ["СРЕДства", false], ["средстВА", false]])),
        questionBlock("<p>4. Как правильно?</p>", singleChoice([["докумЕнт", true], ["ДОКУмент", false], ["докУмент", false], ["документ (без ударения)", false]])),
        questionBlock("<p>5. Как правильно?</p>", singleChoice([["красИвее", true], ["красивЕе", false], ["КРАсивее", false], ["красивеЕ", false]])),
      ]),
      item("ru_word_parts", "Разбор слова по составу", [
        richText("<h3>Разбор слова по составу</h3><p>Слово: <strong>подсказка</strong></p>"),
        questionBlock("<p>Приставка</p>", textInput(["под"])),
        questionBlock("<p>Корень</p>", textInput(["сказ"])),
        questionBlock("<p>Суффикс</p>", textInput(["к"])),
        questionBlock("<p>Окончание</p>", textInput(["а"])),
      ]),
      item("ru_syntax_parse", "Синтаксический разбор предложения", [
        questionBlock(
          "<p>Выделите подлежащее и сказуемое</p>",
          highlightText([["Дети", true], ["весело", false], ["играли", true], ["во", false], ["дворе", false]]),
        ),
      ]),
      item("ru_fix_error", "Найди и исправь ошибку", [
        richText("<p>В предложении есть ошибка. Перепишите его правильно.</p><p><em>«Одеть пальто и выйти на улицу.»</em></p>"),
        questionBlock("<p>Исправленное предложение</p>", textInput(["Надеть пальто и выйти на улицу"])),
      ]),
      item("ru_text_work", "Работа с текстом (ОГЭ/ЕГЭ)", [
        richText(
          "<h3>Текст</h3><p>Осенью дни становятся короче, а ночи — длиннее. Птицы улетают в тёплые края. Деревья сбрасывают листву, готовясь к зиме.</p>",
        ),
        questionBlock(
          "<p>Что происходит с днями осенью?</p>",
          singleChoice([["Дни становятся короче", true], ["Дни становятся длиннее", false], ["Дни не меняются", false], ["Дни исчезают", false]]),
        ),
        questionBlock(
          "<p>Куда улетают птицы?</p>",
          singleChoice([["В тёплые края", true], ["На север", false], ["В горы", false], ["Под землю", false]]),
        ),
        questionBlock(
          "<p>Зачем деревья сбрасывают листву?</p>",
          singleChoice([["Готовятся к зиме", true], ["От жары", false], ["Просто так", false], ["Из-за дождя", false]]),
        ),
        questionBlock("<p>Ночи осенью становятся длиннее.</p>", trueFalse(true)),
        questionBlock(
          "<p>Опишите своими словами, как меняется природа осенью.</p>",
          openAnswer(600, [["Названы минимум 2 признака осени", 1], ["Ответ связный, без грубых ошибок", 1]]),
        ),
      ]),
      item("ru_parts_of_speech", "Части речи", [
        questionBlock(
          "<p>Разложите слова по частям речи</p>",
          categorize([
            ["Существительное", ["дом", "окно", "книга"]],
            ["Прилагательное", ["красивый", "быстрый"]],
            ["Глагол", ["бежать", "читать"]],
          ]),
        ),
      ]),
    ],
  },

  {
    subject: "Литература",
    items: [
      item("lit_quote_analysis", "Цитата и анализ", [
        callout("example", "<p><strong>Цитата.</strong> «Я вас любил: любовь ещё, быть может, / В душе моей угасла не совсем…» (А.С. Пушкин)</p>"),
        questionBlock(
          "<p>Как вы понимаете смысл этой цитаты?</p>",
          openAnswer(800, [["Верно передан общий смысл", 1], ["Есть личная интерпретация", 1]]),
        ),
      ]),
      item("lit_author_match", "Кто автор строк", [
        richText("<p>Сопоставьте произведения и их авторов.</p>"),
        questionBlock(
          "<p>Сопоставьте произведение и автора</p>",
          matching([
            ["«Евгений Онегин»", "А. С. Пушкин"],
            ["«Мёртвые души»", "Н. В. Гоголь"],
            ["«Война и мир»", "Л. Н. Толстой"],
          ]),
        ),
      ]),
      item("lit_hero_work", "Герой — произведение", [
        questionBlock(
          "<p>Сопоставьте героя и произведение</p>",
          matching([
            ["Печорин", "«Герой нашего времени»"],
            ["Онегин", "«Евгений Онегин»"],
            ["Чичиков", "«Мёртвые души»"],
          ]),
        ),
      ]),
      item("lit_timeline", "Хронология сюжета", [
        questionBlock(
          "<p>Расставьте события «Капитанской дочки» в порядке сюжета</p>",
          ordering([
            "Гринёв отправляется на военную службу",
            "Знакомство с Пугачёвым во время бурана",
            "Осада Белогорской крепости",
            "Гринёва оправдывают благодаря заступничеству Маши",
          ]),
        ),
      ]),
      item("lit_expressive_means", "Средства выразительности", [
        questionBlock(
          "<p>Найдите в отрывке эпитет: «Мороз и солнце; день чудесный!» (А.С. Пушкин)</p>",
          highlightText([["Мороз", false], ["и", false], ["солнце;", false], ["день", false], ["чудесный!", true]]),
        ),
        questionBlock(
          "<p>Какое средство выразительности вы нашли?</p>",
          singleChoice([["Эпитет", true], ["Метафора", false], ["Сравнение", false], ["Олицетворение", false]]),
        ),
      ]),
      item("lit_essay", "Сочинение-миниатюра", [
        questionBlock(
          "<p>Напишите сочинение-миниатюру на тему «Мой любимый литературный герой»</p>",
          openAnswer(1500, [["Раскрытие темы", 1], ["Структура и логика", 1], ["Грамотность", 1]]),
          3,
        ),
      ]),
    ],
  },

  {
    subject: "Английский язык",
    items: [
      item("en_vocab_match", "Слово — перевод", [
        questionBlock(
          "<p>Match the word with its translation</p>",
          matching([
            ["house", "дом"],
            ["book", "книга"],
            ["water", "вода"],
            ["friend", "друг"],
            ["school", "школа"],
          ]),
        ),
      ]),
      item("en_listening", "Listening", [
        mediaPlaceholder("audio", "«Hello! My name is Anna. I am eleven years old and I live in Moscow.»"),
        questionBlock(
          "<p>What is the text about?</p>",
          singleChoice([["A girl introducing herself", true], ["A weather forecast", false], ["A recipe", false], ["A football match", false]]),
        ),
        questionBlock("<p>Anna is eleven years old.</p>", trueFalse(true)),
      ]),
      item("en_grammar_gaps", "Грамматика: выбери форму", [
        questionBlock(
          "<p>Choose the correct verb form</p>",
          clozeDropdown("She {{g1}} to school every day.", { g1: { options: ["go", "goes", "going"], correct: "goes" } }),
        ),
      ]),
      item("en_word_order", "Порядок слов в предложении", [
        questionBlock("<p>Put the words in the correct order</p>", ordering(["Where", "do", "you", "live", "?"])),
      ]),
      item("en_dialogue_gaps", "Диалог с пропусками", [
        richText("<p>Complete the dialogue.</p>"),
        questionBlock("<p>— Hello! ___</p>", textInput(["How are you?"], { typoTolerance: 2 })),
        questionBlock("<p>— ___ Thank you, bye!</p>", textInput(["I'm fine"], { typoTolerance: 2 })),
      ]),
      item("en_word_formation", "Word formation", [
        richText("<p>Form the correct word from the word in brackets.</p>"),
        questionBlock("<p>happy → ______ (noun)</p>", textInput(["happiness"])),
        questionBlock("<p>act → ______ (adjective)</p>", textInput(["active"])),
        questionBlock("<p>friend → ______ (adjective)</p>", textInput(["friendly"])),
      ]),
    ],
  },

  {
    subject: "Математика",
    items: [
      item("math_equation", "Реши уравнение", [
        questionBlock("<p>Решите уравнение 3x + 5 = 20 и укажите x</p>", numericInput(5, { kind: "absolute", value: 0.01 })),
      ]),
      item("math_formula_chain", "Формула → подстановка → ответ", [
        formula("S = v \\cdot t"),
        richText("<p>Автомобиль ехал со скоростью 60 км/ч в течение 2 часов. Подставим значения в формулу.</p>"),
        questionBlock("<p>Чему равно пройденное расстояние S (в км)?</p>", numericInput(120, { kind: "relative", value: 0.01 })),
      ]),
      item("math_proof_steps", "Шаги доказательства", [
        questionBlock(
          "<p>Расставьте шаги доказательства теоремы о сумме углов треугольника</p>",
          ordering([
            "Проведём через вершину C прямую, параллельную стороне AB.",
            "Углы при параллельных прямых и секущей равны как накрест лежащие.",
            "Угол при вершине C и два накрест лежащих угла лежат на одной прямой.",
            "Сумма углов на прямой равна 180° — значит, сумма углов треугольника равна 180°.",
          ]),
        ),
      ]),
      item("math_figure_problem", "Задача с чертежом", [
        mediaPlaceholder("image", "прямоугольник со сторонами 6 см и 4 см"),
        questionBlock("<p>Найдите площадь прямоугольника (в см²)</p>", numericInput(24, { kind: "absolute", value: 0.01 })),
      ]),
      item("math_find_error", "Найди ошибку в решении", [
        richText("<h3>Решение уравнения 2x + 3 = 11</h3><p>Шаг 1. 2x + 3 = 11.<br>Шаг 2. 2x = 11 + 3 = 14.<br>Шаг 3. x = 7.</p>"),
        questionBlock(
          "<p>На каком шаге допущена ошибка?</p>",
          singleChoice([["Шаг 1", false], ["Шаг 2", true], ["Шаг 3", false], ["Ошибки нет", false]]),
        ),
      ]),
      item("math_mental_math", "Устный счёт", [
        questionBlock("<p>1. 7 + 8</p>", numericInput(15, { kind: "absolute", value: 0 })),
        questionBlock("<p>2. 12 − 5</p>", numericInput(7, { kind: "absolute", value: 0 })),
        questionBlock("<p>3. 6 × 4</p>", numericInput(24, { kind: "absolute", value: 0 })),
        questionBlock("<p>4. 36 ÷ 6</p>", numericInput(6, { kind: "absolute", value: 0 })),
        questionBlock("<p>5. 15 + 27</p>", numericInput(42, { kind: "absolute", value: 0 })),
        questionBlock("<p>6. 100 − 45</p>", numericInput(55, { kind: "absolute", value: 0 })),
        questionBlock("<p>7. 9 × 9</p>", numericInput(81, { kind: "absolute", value: 0 })),
        questionBlock("<p>8. 144 ÷ 12</p>", numericInput(12, { kind: "absolute", value: 0 })),
        questionBlock("<p>9. 13 + 19</p>", numericInput(32, { kind: "absolute", value: 0 })),
        questionBlock("<p>10. 8 × 7</p>", numericInput(56, { kind: "absolute", value: 0 })),
      ]),
    ],
  },

  {
    subject: "Физика",
    items: [
      item("phys_units_problem", "Задача с единицами измерения", [
        questionBlock(
          "<p>Автомобиль проехал 90 км за 1,5 часа. Найдите его скорость.</p>",
          numericInput(60, { kind: "relative", value: 0.02 }, "км/ч", true),
        ),
      ]),
      item("phys_lab_table", "Лабораторная: таблица измерений", [
        richText("<p>За 10 полных колебаний маятника секундомер показал 15 с. Заполните таблицу и вычислите период одного колебания (T = t / N).</p>"),
        questionBlock(
          "<p>Заполните таблицу результатами измерений</p>",
          tableFill([
            ["Величина", "Значение"],
            ["Количество колебаний N", { answer: "10" }],
            ["Полное время t, с", { answer: "15" }],
            ["Период T = t/N, с", { answer: "1.5" }],
          ]),
        ),
        questionBlock(
          "<p>Сформулируйте вывод по результатам измерений</p>",
          openAnswer(600, [["Верно вычислен период", 1], ["Объяснена формула T = t/N", 1]]),
        ),
      ]),
      item("phys_graph_reading", "Чтение графика", [
        mediaPlaceholder("image", "график равномерного движения — координата тела от времени"),
        questionBlock(
          "<p>Что происходит на графике равномерного движения при t = 0?</p>",
          singleChoice([["Тело находится в начальной точке", true], ["Тело покоится в конце пути", false], ["Тело движется назад", false], ["График не определён", false]]),
        ),
        questionBlock(
          "<p>Тело прошло 8 м за 4 с равномерного движения. Определите скорость (в м/с)</p>",
          numericInput(2, { kind: "absolute", value: 0.01 }),
        ),
      ]),
      item("phys_formula_match", "Формула — что выражает", [
        questionBlock(
          "<p>Сопоставьте формулу и величину</p>",
          matching([
            ["v = s/t", "скорость"],
            ["F = ma", "сила"],
            ["p = mv", "импульс"],
          ]),
        ),
      ]),
      item("phys_why_question", "Качественный вопрос «почему»", [
        questionBlock(
          "<p>Объясните, почему в жаркий день асфальт нагревается сильнее, чем трава рядом с ним</p>",
          openAnswer(800, [["Верное объяснение (разная теплоёмкость/поглощение света)", 1], ["Использованы физические термины", 1]]),
        ),
      ]),
      item("phys_circuit_scheme", "Схема электрической цепи", [
        mediaPlaceholder("image", "батарея, ключ и лампочка, соединённые последовательно"),
        questionBlock(
          "<p>Опишите, как соединены элементы цепи и что произойдёт, если разомкнуть ключ</p>",
          openAnswer(500, [["Верно описано последовательное соединение", 1], ["Верно объяснён разрыв цепи", 1]]),
        ),
      ]),
    ],
  },

  {
    subject: "Химия",
    items: [
      item("chem_classify", "Классификация веществ", [
        questionBlock(
          "<p>Разложите вещества по группам</p>",
          categorize([
            ["Металлы", ["натрий", "железо", "медь"]],
            ["Неметаллы", ["кислород", "водород"]],
          ]),
        ),
      ]),
      item("chem_chain", "Цепочка превращений", [
        richText("<p>Схема цепочки: Na → (реакция с O₂) → B → (реакция с H₂O) → C → (реакция с CO₂) → D</p>"),
        questionBlock("<p>Продукт реакции 1 (B)</p>", textInput(["оксид натрия"])),
        questionBlock("<p>Продукт реакции 2 (C)</p>", textInput(["гидроксид натрия"])),
        questionBlock("<p>Продукт реакции 3 (D)</p>", textInput(["карбонат натрия"])),
      ]),
      item("chem_calc_problem", "Расчётная задача по уравнению", [
        questionBlock(
          "<p>Вычислите массу оксида магния MgO, образующегося при сгорании 4,8 г магния (M(Mg) = 24 г/моль, M(MgO) = 40 г/моль): 2Mg + O₂ → 2MgO</p>",
          numericInput(8, { kind: "relative", value: 0.02 }, "г"),
        ),
      ]),
      item("chem_balance_eq", "Уравняй реакцию", [
        richText("<p>Уравнение: __Fe + __O₂ → __Fe₂O₃</p>"),
        questionBlock("<p>Впишите коэффициенты через пробел, в порядке слева направо</p>", textInput(["4 3 2"], { typoTolerance: 0 })),
      ]),
      item("chem_periodic_table", "Элемент — свойство", [
        questionBlock(
          "<p>Сопоставьте элемент и его свойство</p>",
          matching([
            ["Натрий", "Щелочной металл"],
            ["Хлор", "Галоген"],
            ["Гелий", "Инертный газ"],
          ]),
        ),
      ]),
      item("chem_safety", "Техника безопасности", [
        mediaPlaceholder("image", "ученик пробует вещество на вкус в лаборатории"),
        questionBlock(
          "<p>Какое правило техники безопасности нарушено на изображении?</p>",
          singleChoice([["Нельзя пробовать вещества на вкус", true], ["Нельзя мыть посуду", false], ["Нельзя записывать результаты", false], ["Нельзя работать в перчатках", false]]),
        ),
      ]),
    ],
  },

  {
    subject: "Биология",
    items: [
      item("bio_label_scheme", "Подпиши схему", [
        mediaPlaceholder("image", "схема строения клетки с тремя пронумерованными частями"),
        questionBlock("<p>Часть 1 (управляет всеми процессами клетки)</p>", textInput(["ядро"])),
        questionBlock("<p>Часть 2 (защищает клетку снаружи)</p>", textInput(["мембрана"])),
        questionBlock("<p>Часть 3 (вещество, заполняющее клетку)</p>", textInput(["цитоплазма"])),
      ]),
      item("bio_classify_organisms", "Классификация организмов", [
        questionBlock(
          "<p>Разложите организмов по группам</p>",
          categorize([
            ["Позвоночные", ["лягушка", "окунь"]],
            ["Беспозвоночные", ["дождевой червь", "медуза", "улитка"]],
          ]),
        ),
      ]),
      item("bio_process_order", "Последовательность процесса", [
        questionBlock("<p>Расставьте фазы митоза в правильном порядке</p>", ordering(["Профаза", "Метафаза", "Анафаза", "Телофаза"])),
      ]),
      item("bio_compare_table", "Сравнительная таблица", [
        questionBlock(
          "<p>Заполните таблицу сравнения растительной и животной клетки</p>",
          tableFill([
            ["Признак", "Растительная клетка", "Животная клетка"],
            ["Клеточная стенка", { answer: "есть" }, { answer: "нет" }],
          ]),
        ),
        questionBlock(
          "<p>Сформулируйте вывод из сравнения</p>",
          openAnswer(500, [["Названо хотя бы одно верное отличие", 1]]),
        ),
      ]),
      item("bio_identify_photo", "Определи по фотографии", [
        mediaPlaceholder("image", "пресноводная рыба с усами возле рта"),
        questionBlock(
          "<p>Что изображено на фотографии?</p>",
          singleChoice([["Сом", true], ["Щука", false], ["Карась", false], ["Окунь", false]]),
        ),
      ]),
    ],
  },

  {
    subject: "География",
    items: [
      item("geo_contour_map", "Контурная карта", [
        mediaPlaceholder("image", "контурная карта с отмеченным самым глубоким озером мира"),
        questionBlock("<p>Назовите отмеченный объект</p>", textInput(["Байкал"])),
      ]),
      item("geo_capitals", "Страна — столица", [
        questionBlock(
          "<p>Сопоставьте страну и столицу</p>",
          matching([
            ["Франция", "Париж"],
            ["Германия", "Берлин"],
            ["Италия", "Рим"],
            ["Испания", "Мадрид"],
            ["Япония", "Токио"],
          ]),
        ),
      ]),
      item("geo_coordinates", "Координаты точки", [
        mediaPlaceholder("image", "карта с отмеченным городом Москва"),
        questionBlock("<p>Широта города Москвы</p>", numericInput(55.75, { kind: "absolute", value: 1 }, "°")),
        questionBlock("<p>Долгота города Москвы</p>", numericInput(37.62, { kind: "absolute", value: 1 }, "°")),
      ]),
      item("geo_climatogram", "Чтение климатограммы", [
        richText("<p>Климатограмма умеренно континентального климата средней полосы России: самый тёплый месяц — июль, самый холодный — январь, среднегодовое количество осадков — около 600 мм.</p>"),
        questionBlock("<p>Какой месяц самый тёплый?</p>", singleChoice([["Июль", true], ["Январь", false], ["Март", false], ["Октябрь", false]])),
        questionBlock("<p>Какое среднегодовое количество осадков (в мм)?</p>", numericInput(600, { kind: "relative", value: 0.05 })),
      ]),
      item("geo_natural_zones", "Природные зоны", [
        questionBlock(
          "<p>Разложите по природным зонам</p>",
          categorize([
            ["Тундра", ["морошка", "лишайник", "песец"]],
            ["Пустыня", ["кактус", "верблюд", "саксаул"]],
          ]),
        ),
      ]),
    ],
  },

  {
    subject: "История и обществознание",
    items: [
      item("hist_timeline", "Лента времени", [
        questionBlock(
          "<p>Расставьте события в хронологическом порядке</p>",
          ordering([
            "Крещение Руси (988 год)",
            "Куликовская битва (1380 год)",
            "Отмена крепостного права (1861 год)",
            "Октябрьская революция (1917 год)",
            "Победа в Великой Отечественной войне (1945 год)",
          ]),
        ),
      ]),
      item("hist_date_event", "Дата — событие", [
        questionBlock(
          "<p>Сопоставьте дату и событие</p>",
          matching([
            ["1812", "Отечественная война с Наполеоном"],
            ["1861", "Отмена крепостного права"],
            ["1917", "Октябрьская революция"],
            ["1941", "Начало Великой Отечественной войны"],
            ["1961", "Полёт Юрия Гагарина в космос"],
          ]),
        ),
      ]),
      item("hist_source_work", "Работа с историческим источником", [
        richText(
          "<h3>Фрагмент источника (в изложении)</h3><p>По манифесту 19 февраля 1861 года крестьяне получали личную свободу и гражданские права, но были обязаны выкупать землю у помещиков.</p>",
        ),
        questionBlock(
          "<p>В каком году был издан документ, о котором идёт речь?</p>",
          singleChoice([["1861", true], ["1905", false], ["1917", false], ["1825", false]]),
        ),
        questionBlock(
          "<p>Что получили крестьяне согласно документу?</p>",
          singleChoice([["Личную свободу", true], ["Землю бесплатно", false], ["Дворянский титул", false], ["Право голоса на выборах", false]]),
        ),
        questionBlock(
          "<p>Как называется описываемое историческое событие?</p>",
          singleChoice([["Отмена крепостного права", true], ["Октябрьская революция", false], ["Смутное время", false], ["Опричнина", false]]),
        ),
        questionBlock(
          "<p>Как этот документ характеризует эпоху?</p>",
          openAnswer(800, [["Верно указан переход от крепостной зависимости", 1], ["Ответ связный и по существу", 1]]),
        ),
      ]),
      item("hist_recognize_person", "Узнай личность по портрету", [
        mediaPlaceholder("image", "портрет российского императора, отменившего крепостное право в 1861 году"),
        questionBlock(
          "<p>Кто изображён на портрете?</p>",
          singleChoice([["Александр II", true], ["Николай I", false], ["Пётр I", false], ["Александр I", false]]),
        ),
      ]),
      item("hist_battle_map", "Карта сражения / территории", [
        mediaPlaceholder("image", "карта сражения 1812 года близ Москвы"),
        questionBlock("<p>Назовите отмеченное сражение</p>", textInput(["Бородинское сражение", "Бородино"])),
      ]),
      item("hist_legal_case", "Правовой кейс", [
        richText("<h3>Ситуация</h3><p>Пятнадцатилетний подросток устроился на работу без согласия родителей.</p>"),
        questionBlock(
          "<p>Как должна быть разрешена эта ситуация с точки зрения закона?</p>",
          openAnswer(600, [["Упомянуто требование согласия родителя/опекуна для подростка 14–15 лет", 1]]),
        ),
      ]),
      item("hist_concept_features", "Признаки понятия", [
        questionBlock(
          "<p>Отметьте признаки, характерные для понятия «демократия»</p>",
          multipleChoice([
            ["Выборность органов власти", true],
            ["Разделение властей", true],
            ["Наследственная передача власти", false],
            ["Многопартийность", true],
          ]),
        ),
      ]),
    ],
  },

  {
    subject: "Информатика",
    items: [
      item("inf_program_output", "Что выведет программа", [
        richText("<pre>for i in range(3):\n    print(i)</pre>"),
        questionBlock("<p>Что выведет программа (числа через пробел)?</p>", textInput(["0 1 2"], { typoTolerance: 0 })),
      ]),
      item("inf_code_gaps", "Код с пропусками", [
        richText("<pre>def add(a, b):\n    return a ___ b</pre>"),
        questionBlock("<p>Пропуск 1 — оператор сложения</p>", textInput(["+"], { typoTolerance: 0 })),
        richText("<pre>for i in range(___):\n    print(i)  # выведет 0 1 2 3 4</pre>"),
        questionBlock("<p>Пропуск 2 — сколько чисел нужно вывести</p>", numericInput(5, { kind: "absolute", value: 0 })),
      ]),
      item("inf_algorithm_trace", "Трассировка алгоритма", [
        richText("<pre>i = 1\ns = 0\nwhile i &lt;= 3:\n    s = s + i\n    i = i + 1</pre>"),
        questionBlock(
          "<p>Заполните таблицу трассировки</p>",
          tableFill([
            ["Шаг", "i", "s"],
            ["После шага 1", { answer: "2" }, { answer: "1" }],
            ["После шага 2", { answer: "3" }, { answer: "3" }],
            ["После шага 3", { answer: "4" }, { answer: "6" }],
          ]),
        ),
        questionBlock("<p>Итоговое значение переменной s</p>", textInput(["6"], { typoTolerance: 0 })),
      ]),
      item("inf_algorithm_order", "Порядок блоков алгоритма", [
        questionBlock(
          "<p>Расставьте шаги алгоритма поиска максимума в массиве по порядку</p>",
          ordering([
            "Взять первый элемент массива как текущий максимум",
            "Перейти к следующему элементу массива",
            "Если элемент больше текущего максимума — обновить максимум",
            "Повторять, пока не закончится массив",
          ]),
        ),
      ]),
      item("inf_number_system", "Перевод систем счисления", [
        questionBlock("<p>Переведите число 13 (десятичное) в двоичную систему счисления</p>", numericInput(1101, { kind: "absolute", value: 0 })),
      ]),
      item("inf_truth_table", "Таблица истинности", [
        table([
          ["A", "B", "A ∧ B"],
          ["0", "0", "0"],
          ["0", "1", "0"],
          ["1", "0", "0"],
          ["1", "1", "1"],
        ]),
        questionBlock(
          "<p>При каких значениях A и B выражение A ∧ B истинно?</p>",
          singleChoice([["A=0, B=0", false], ["A=0, B=1", false], ["A=1, B=0", false], ["A=1, B=1", true]]),
        ),
      ]),
    ],
  },

  {
    subject: "Музыка, ИЗО, ОБЖ",
    items: [
      item("art_audio_question", "Музыкальный фрагмент", [
        mediaPlaceholder("audio", "плавная мелодия скрипки в темпе вальса"),
        questionBlock(
          "<p>Какой инструмент исполняет мелодию?</p>",
          singleChoice([["Скрипка", true], ["Труба", false], ["Барабан", false], ["Флейта", false]]),
        ),
      ]),
      item("art_reproduction_analysis", "Анализ репродукции", [
        mediaPlaceholder("image", "картина И.И. Шишкина «Утро в сосновом лесу»"),
        questionBlock(
          "<p>Опишите и проанализируйте изображение: что изображено, какое настроение передаёт картина?</p>",
          openAnswer(700, [["Описан сюжет картины", 1], ["Отмечено настроение/впечатление", 1]]),
        ),
      ]),
      item("art_recognize_style", "Узнай стиль или эпоху", [
        mediaPlaceholder("image", "яркие смазанные мазки, естественный свет и сюжеты — конец XIX века, Франция"),
        questionBlock(
          "<p>К какому стилю/эпохе относится изображение?</p>",
          singleChoice([["Импрессионизм", true], ["Классицизм", false], ["Кубизм", false], ["Готика", false]]),
        ),
      ]),
      item("safety_algorithm", "Алгоритм действий в ЧС", [
        questionBlock(
          "<p>Расставьте действия при пожарной тревоге по порядку</p>",
          ordering([
            "Услышав сигнал пожарной тревоги, прекратите работу",
            "Отключите электроприборы",
            "Возьмите документы и покиньте помещение по эвакуационному выходу",
            "Соберитесь в установленном месте сбора и сообщите о своём присутствии",
          ]),
        ),
      ]),
    ],
  },
];

// ─── Сборка материала ────────────────────────────────────────────────

function assertCoverage(sections: ShowcaseSection[]) {
  const covered = new Set(sections.flatMap((s) => s.items.map((i) => i.id)));
  const missing = ALL_CONSTRUCT_IDS.filter((id) => !covered.has(id));
  if (missing.length > 0) {
    throw new Error(`Витрина не покрывает все конструкции — пропущены: ${missing.join(", ")}`);
  }
  const extra = [...covered].filter((id) => !(ALL_CONSTRUCT_IDS as readonly string[]).includes(id));
  if (extra.length > 0) {
    throw new Error(`Витрина ссылается на несуществующие id конструкций: ${extra.join(", ")}`);
  }
}

assertCoverage(SECTIONS);

const blocks: MaterialBlock[] = [
  richText("<h2>Витрина конструкций редактора материалов</h2>"),
  spoiler(
    "Как устроен этот материал",
    `<p>Этот материал — каталог: он использует <strong>каждую</strong> конструкцию из пикера
     конструкций (кнопка «/» → «Конструкции» в редакторе), заполненную настоящим
     предметным содержанием, а не заготовками-плейсхолдерами. Разделы идут по
     предметам в том же порядке, что и в пикере; перед каждым упражнением —
     подзаголовок с названием конструкции. Материал специально «переполнен» —
     он не рассчитан на прохождение одним учеником целиком, это витрина
     возможностей для методиста.</p>`,
  ),
];

for (const section of SECTIONS) {
  blocks.push(richText(`<h2>${section.subject}</h2>`));
  for (const it of section.items) {
    blocks.push(richText(`<h3>${it.label}</h3>`));
    blocks.push(...it.blocks);
  }
}

const material: Material = {
  id: uid(),
  schemaVersion: 1,
  title: "Витрина конструкций редактора",
  subject: "Все предметы",
  grades: [5, 6, 7, 8, 9],
  topic: "Обзор конструкций и типов заданий редактора материалов",
  tags: ["витрина", "конструкции", "демонстрация"],
  settings: { shuffleBlocks: false, showFeedback: "after_submit", attemptsAllowed: 5 },
  blocks,
  groups: [],
};

// ─── Валидация и запись ─────────────────────────────────────────────

const parsed = materialSchema.parse(material); // бросит исключение при малейшем несоответствии схеме
const issues = validateMaterialContent(parsed);

const outPath = fileURLToPath(new URL("../../../../docs/materials/construct-showcase.json", import.meta.url));
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(parsed, null, 2), "utf8");

/**
 * Структура по разделам/конструкциям — отдельным файлом ДЛЯ ЧТЕНИЯ (не для
 * seed-material.ts, тот берёт только construct-showcase.json). Нужна,
 * потому что сам `Material.blocks` — плоский список (формат хранения,
 * менять нельзя), а несколько конструкций используют `<h2>`/`<h3>` В
 * СВОЁМ содержимом (например, `problem_walkthrough`) — разбирать разделы
 * назад по заголовкам из плоского списка было бы хрупко (ровно так
 * сначала и делал витрину-артефакт — задваивало разделы). Экспортируем
 * готовую структуру, чтобы любой внешний просмотрщик не гадал.
 */
const sectionsOut = SECTIONS.map((s) => ({
  subject: s.subject,
  items: s.items.map((it) => ({ id: it.id, label: it.label, blocks: it.blocks })),
}));
const sectionsPath = fileURLToPath(new URL("../../../../docs/materials/construct-showcase-sections.json", import.meta.url));
await writeFile(sectionsPath, JSON.stringify(sectionsOut, null, 2), "utf8");

console.log(`Материал собран: ${parsed.blocks.length} блоков, ${SECTIONS.length} разделов, ${SECTIONS.flatMap((s) => s.items).length} конструкций.`);
console.log(`Записано: ${outPath}`);
console.log(`Записано (структура по разделам): ${sectionsPath}`);
if (issues.length > 0) {
  console.log(`\nОставшиеся проблемы валидатора (${issues.length}):`);
  for (const i of issues) console.log(`  [${i.code}] ${i.blockId ?? "—"}: ${i.message}`);
} else {
  console.log("validateMaterialContent: проблем нет.");
}
