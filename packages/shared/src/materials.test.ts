import { describe, expect, it } from "vitest";
import {
  clozeDropdownInteractionSchema,
  materialSchema,
  matchingInteractionSchema,
  multipleChoiceInteractionSchema,
  orderingInteractionSchema,
  singleChoiceInteractionSchema,
  stripInteractionAnswerKey,
  stripMaterialAnswerKeys,
  type Material,
} from "./materials.js";

describe("stripInteractionAnswerKey (§ «Железные правила» CLAUDE.md: ключи ответов не уходят на клиент)", () => {
  it("single_choice: убирает correct, оставляет id/html", () => {
    const interaction = singleChoiceInteractionSchema.parse({
      type: "single_choice",
      shuffle: false,
      options: [
        { id: "o1", html: "1", correct: true },
        { id: "o2", html: "2", correct: false },
      ],
    });

    const stripped = stripInteractionAnswerKey(interaction, "seed") as { options: unknown[] };

    expect(JSON.stringify(stripped)).not.toContain("correct");
    expect(stripped.options).toEqual([
      { id: "o1", html: "1" },
      { id: "o2", html: "2" },
    ]);
  });

  it("single_choice с shuffle: перемешивает, но не теряет и не дублирует варианты", () => {
    const interaction = singleChoiceInteractionSchema.parse({
      type: "single_choice",
      shuffle: true,
      options: [
        { id: "o1", html: "1", correct: true },
        { id: "o2", html: "2", correct: false },
        { id: "o3", html: "3", correct: false },
        { id: "o4", html: "4", correct: false },
      ],
    });

    const stripped = stripInteractionAnswerKey(interaction, "attempt-1:q1") as { options: { id: string }[] };

    expect(stripped.options.map((o) => o.id).sort()).toEqual(["o1", "o2", "o3", "o4"]);
  });

  it("single_choice с shuffle: один и тот же seed даёт одно и то же перемешивание (стабильно при перезагрузке страницы)", () => {
    const interaction = singleChoiceInteractionSchema.parse({
      type: "single_choice",
      shuffle: true,
      options: [
        { id: "o1", html: "1", correct: true },
        { id: "o2", html: "2", correct: false },
        { id: "o3", html: "3", correct: false },
        { id: "o4", html: "4", correct: false },
        { id: "o5", html: "5", correct: false },
      ],
    });

    const first = stripInteractionAnswerKey(interaction, "attempt-1:q1");
    const second = stripInteractionAnswerKey(interaction, "attempt-1:q1");

    expect(first).toEqual(second);
  });

  it("multiple_choice: убирает correct так же, как single_choice", () => {
    const interaction = multipleChoiceInteractionSchema.parse({
      type: "multiple_choice",
      shuffle: false,
      options: [
        { id: "o1", html: "1", correct: true },
        { id: "o2", html: "2", correct: true },
        { id: "o3", html: "3", correct: false },
      ],
    });

    const stripped = JSON.stringify(stripInteractionAnswerKey(interaction, "seed"));

    expect(stripped).not.toContain("correct");
  });

  it("true_false: не отдаёт ничего, кроме type", () => {
    const stripped = stripInteractionAnswerKey({ type: "true_false", correct: true }, "seed");
    expect(stripped).toEqual({ type: "true_false" });
  });

  it("text_input: не отдаёт answers", () => {
    const stripped = stripInteractionAnswerKey(
      {
        type: "text_input",
        answers: [{ value: "дискриминант", match: "normalized" }],
        caseSensitive: false,
        trimWhitespace: true,
        typoTolerance: 1,
      },
      "seed",
    );
    expect(stripped).toEqual({ type: "text_input" });
  });

  it("numeric_input: не отдаёт value и tolerance, только unit/unitRequired", () => {
    const stripped = stripInteractionAnswerKey(
      {
        type: "numeric_input",
        value: 9.81,
        tolerance: { kind: "relative", value: 0.01 },
        unit: "м/с²",
        unitRequired: true,
      },
      "seed",
    );
    expect(stripped).toEqual({ type: "numeric_input", unit: "м/с²", unitRequired: true });
  });

  it("open_answer: не отдаёт rubric", () => {
    const stripped = JSON.stringify(
      stripInteractionAnswerKey(
        {
          type: "open_answer",
          maxLength: 2000,
          allowAttachments: true,
          rubric: [{ id: "c1", label: "Формула записана верно", points: 1 }],
        },
        "seed",
      ),
    );
    expect(stripped).not.toContain("rubric");
    expect(stripped).not.toContain("points");
  });

  it("cloze_dropdown: оставляет options по каждому пропуску, убирает correct", () => {
    const interaction = clozeDropdownInteractionSchema.parse({
      type: "cloze_dropdown",
      template: "Столица Франции — {{g1}}.",
      gaps: { g1: { options: ["Париж", "Лион", "Марсель"], correct: "Париж" } },
    });

    const stripped = JSON.stringify(stripInteractionAnswerKey(interaction, "seed"));

    expect(stripped).not.toContain("correct");
    expect(stripped).toContain("Марсель");
  });

  it("cloze_text: не отдаёт answers по пропускам, только их id", () => {
    const stripped = stripInteractionAnswerKey(
      {
        type: "cloze_text",
        template: "{{g1}} + {{g2}} = 4",
        gaps: {
          g1: { answers: [{ value: "2", match: "exact" }], caseSensitive: false, trimWhitespace: true, typoTolerance: 0 },
          g2: { answers: [{ value: "2", match: "exact" }], caseSensitive: false, trimWhitespace: true, typoTolerance: 0 },
        },
      },
      "seed",
    );
    expect(JSON.stringify(stripped)).not.toContain("answers");
    expect(stripped).toEqual({ type: "cloze_text", template: "{{g1}} + {{g2}} = 4", gapIds: ["g1", "g2"] });
  });

  it("matching: не отдаёт pairs", () => {
    const interaction = matchingInteractionSchema.parse({
      type: "matching",
      left: [{ id: "l1", html: "H₂O" }],
      right: [{ id: "r1", html: "вода" }, { id: "r2", html: "соль" }],
      pairs: [["l1", "r1"]],
      scoring: "partial",
      distractors: ["r2"],
    });

    const stripped = JSON.stringify(stripInteractionAnswerKey(interaction, "seed"));

    expect(stripped).not.toContain("pairs");
  });

  it("ordering: перемешивает items — правильный порядок хранения не должен совпадать с отданным (для достаточно длинного списка)", () => {
    const interaction = orderingInteractionSchema.parse({
      type: "ordering",
      items: [
        { id: "1", html: "Первый" },
        { id: "2", html: "Второй" },
        { id: "3", html: "Третий" },
        { id: "4", html: "Четвёртый" },
        { id: "5", html: "Пятый" },
        { id: "6", html: "Шестой" },
      ],
    });

    const stripped = stripInteractionAnswerKey(interaction, "attempt-1:q1") as { items: { id: string }[] };

    // Тот же набор id, но (почти наверняка для 6 элементов) не тот же порядок —
    // иначе порядок хранения и есть ответ, отданный как есть.
    expect(stripped.items.map((i) => i.id).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(stripped.items.map((i) => i.id)).not.toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("ordering: разный seed — разный порядок (не один и тот же для всех попыток/вопросов)", () => {
    const interaction = orderingInteractionSchema.parse({
      type: "ordering",
      items: [
        { id: "1", html: "a" },
        { id: "2", html: "b" },
        { id: "3", html: "c" },
        { id: "4", html: "d" },
        { id: "5", html: "e" },
      ],
    });

    const a = stripInteractionAnswerKey(interaction, "attempt-1:q1") as { items: { id: string }[] };
    const b = stripInteractionAnswerKey(interaction, "attempt-2:q1") as { items: { id: string }[] };

    expect(a.items.map((i) => i.id)).not.toEqual(b.items.map((i) => i.id));
  });
});

describe("stripMaterialAnswerKeys", () => {
  it("не трогает контентные блоки, снимает ключ ответа с question-блоков", () => {
    const material: Material = materialSchema.parse({
      id: "mat_1",
      schemaVersion: 1,
      title: "Тест",
      subject: "math",
      grades: [8],
      settings: {},
      blocks: [
        { type: "rich_text", id: "b1", html: "<p>Текст</p>" },
        {
          type: "question",
          id: "q1",
          prompt: { html: "<p>2+2?</p>" },
          points: 1,
          interaction: {
            type: "single_choice",
            options: [
              { id: "o1", html: "4", correct: true },
              { id: "o2", html: "5", correct: false },
            ],
          },
        },
      ],
    });

    const publicMaterial = stripMaterialAnswerKeys(material, "attempt-1");

    expect(publicMaterial.blocks[0]).toEqual({ type: "rich_text", id: "b1", html: "<p>Текст</p>" });
    expect(JSON.stringify(publicMaterial.blocks[1])).not.toContain("correct");
  });

  it("не отдаёт feedback (текст обратной связи может выдавать верный вариант)", () => {
    const material: Material = materialSchema.parse({
      id: "mat_1",
      schemaVersion: 1,
      title: "Тест",
      subject: "math",
      grades: [8],
      settings: {},
      blocks: [
        {
          type: "question",
          id: "q1",
          prompt: { html: "<p>2+2?</p>" },
          points: 1,
          feedback: { correct: { html: "Верно, это 4!" } },
          interaction: { type: "true_false", correct: true },
        },
      ],
    });

    const publicMaterial = stripMaterialAnswerKeys(material, "attempt-1");

    expect(JSON.stringify(publicMaterial)).not.toContain("Верно, это 4");
  });
});

describe("materialSchema — базовая валидация формата (§6.1 ТЗ)", () => {
  it("принимает минимальный валидный материал", () => {
    expect(() =>
      materialSchema.parse({
        id: "mat_1",
        schemaVersion: 1,
        title: "Заголовок",
        subject: "math",
        grades: [8],
        settings: {},
        blocks: [],
      }),
    ).not.toThrow();
  });

  it("отклоняет неизвестный schemaVersion", () => {
    expect(() =>
      materialSchema.parse({
        id: "mat_1",
        schemaVersion: 2,
        title: "Заголовок",
        subject: "math",
        grades: [8],
        settings: {},
        blocks: [],
      }),
    ).toThrow();
  });

  it("отклоняет вопрос с interaction неизвестного типа (защита от опечатки в type)", () => {
    expect(() =>
      materialSchema.parse({
        id: "mat_1",
        schemaVersion: 1,
        title: "Заголовок",
        subject: "math",
        grades: [8],
        settings: {},
        blocks: [
          {
            type: "question",
            id: "q1",
            prompt: { html: "?" },
            points: 1,
            interaction: { type: "single_choise", options: [] },
          },
        ],
      }),
    ).toThrow();
  });
});
