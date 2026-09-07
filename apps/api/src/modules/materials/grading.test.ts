import { describe, expect, it } from "vitest";
import type { QuestionInteraction, QuestionResponse } from "@school/shared";
import { gradeResponse } from "./service.js";

const POINTS = 4;

describe("gradeResponse: single_choice", () => {
  const interaction: QuestionInteraction = {
    type: "single_choice",
    shuffle: false,
    options: [
      { id: "o1", html: "4", correct: true },
      { id: "o2", html: "5", correct: false },
      { id: "o3", html: "3", correct: false },
    ],
  };

  it.each([
    ["правильный вариант", "o1", POINTS, true],
    ["неправильный вариант", "o2", 0, false],
    ["ничего не выбрано (null)", null, 0, false],
  ] as const)("%s", (_label, selectedOptionId, expectedScore, expectedCorrect) => {
    const response: QuestionResponse = { type: "single_choice", selectedOptionId };
    const result = gradeResponse(interaction, response, POINTS);
    expect(result).toEqual({ score: expectedScore, maxScore: POINTS, correct: expectedCorrect, autoGraded: true });
  });
});

describe("gradeResponse: multiple_choice — частичные баллы max(0, (верных − неверных) / всего)", () => {
  // 3 correct options (o1,o2,o3) из 5.
  const interaction: QuestionInteraction = {
    type: "multiple_choice",
    shuffle: false,
    options: [
      { id: "o1", html: "1", correct: true },
      { id: "o2", html: "2", correct: true },
      { id: "o3", html: "3", correct: true },
      { id: "o4", html: "4", correct: false },
      { id: "o5", html: "5", correct: false },
    ],
  };

  it("все верные выбраны, ни одного лишнего — полный балл", () => {
    const response: QuestionResponse = { type: "multiple_choice", selectedOptionIds: ["o1", "o2", "o3"] };
    expect(gradeResponse(interaction, response, POINTS)).toEqual({
      score: POINTS,
      maxScore: POINTS,
      correct: true,
      autoGraded: true,
    });
  });

  it("2 из 3 верных, ни одного неверного — частичный балл (2-0)/3", () => {
    const response: QuestionResponse = { type: "multiple_choice", selectedOptionIds: ["o1", "o2"] };
    const result = gradeResponse(interaction, response, POINTS);
    expect(result.score).toBeCloseTo((POINTS * 2) / 3);
    expect(result.correct).toBe(false);
    expect(result.autoGraded).toBe(true);
  });

  it("2 верных + 1 неверный — (2-1)/3", () => {
    const response: QuestionResponse = { type: "multiple_choice", selectedOptionIds: ["o1", "o2", "o4"] };
    const result = gradeResponse(interaction, response, POINTS);
    expect(result.score).toBeCloseTo(POINTS * (1 / 3));
  });

  it("только неверные — балл не уходит в минус, клампится в 0", () => {
    const response: QuestionResponse = { type: "multiple_choice", selectedOptionIds: ["o4", "o5"] };
    const result = gradeResponse(interaction, response, POINTS);
    expect(result.score).toBe(0);
    expect(result.correct).toBe(false);
  });

  it("ничего не выбрано — 0, но не исключение", () => {
    const response: QuestionResponse = { type: "multiple_choice", selectedOptionIds: [] };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(0);
  });
});

describe("gradeResponse: true_false", () => {
  const interaction: QuestionInteraction = { type: "true_false", correct: true };

  it("совпадает — полный балл", () => {
    const response: QuestionResponse = { type: "true_false", value: true };
    expect(gradeResponse(interaction, response, POINTS)).toEqual({
      score: POINTS,
      maxScore: POINTS,
      correct: true,
      autoGraded: true,
    });
  });

  it("не совпадает — 0", () => {
    const response: QuestionResponse = { type: "true_false", value: false };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(0);
  });

  it("не отвечено (null) — 0, не исключение", () => {
    const response: QuestionResponse = { type: "true_false", value: null };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(0);
  });
});

describe("gradeResponse: text_input — exact/normalized/regex, caseSensitive, trimWhitespace, typoTolerance", () => {
  it("exact: точное совпадение проходит, лишний пробел по краям — нет (trimWhitespace: false)", () => {
    const interaction: QuestionInteraction = {
      type: "text_input",
      answers: [{ value: "дискриминант", match: "exact" }],
      caseSensitive: true,
      trimWhitespace: false,
      typoTolerance: 0,
    };
    expect(gradeResponse(interaction, { type: "text_input", value: "дискриминант" }, POINTS).score).toBe(POINTS);
    expect(gradeResponse(interaction, { type: "text_input", value: " дискриминант " }, POINTS).score).toBe(0);
  });

  it("trimWhitespace: true — обрезает пробелы по краям перед сравнением", () => {
    const interaction: QuestionInteraction = {
      type: "text_input",
      answers: [{ value: "дискриминант", match: "exact" }],
      caseSensitive: true,
      trimWhitespace: true,
      typoTolerance: 0,
    };
    expect(gradeResponse(interaction, { type: "text_input", value: "  дискриминант  " }, POINTS).score).toBe(POINTS);
  });

  it("caseSensitive: false — регистр не важен", () => {
    const interaction: QuestionInteraction = {
      type: "text_input",
      answers: [{ value: "Дискриминант", match: "exact" }],
      caseSensitive: false,
      trimWhitespace: true,
      typoTolerance: 0,
    };
    expect(gradeResponse(interaction, { type: "text_input", value: "дискриминант" }, POINTS).score).toBe(POINTS);
  });

  it("normalized: схлопывает повторные пробелы внутри строки, exact — нет", () => {
    const normalized: QuestionInteraction = {
      type: "text_input",
      answers: [{ value: "два корня", match: "normalized" }],
      caseSensitive: false,
      trimWhitespace: true,
      typoTolerance: 0,
    };
    expect(gradeResponse(normalized, { type: "text_input", value: "два   корня" }, POINTS).score).toBe(POINTS);

    const exact: QuestionInteraction = { ...normalized, answers: [{ value: "два корня", match: "exact" }] };
    expect(gradeResponse(exact, { type: "text_input", value: "два   корня" }, POINTS).score).toBe(0);
  });

  it("regex: соответствие по шаблону из примера §6.3 ТЗ", () => {
    const interaction: QuestionInteraction = {
      type: "text_input",
      answers: [{ value: "^дискриминант(а|ом)?$", match: "regex" }],
      caseSensitive: false,
      trimWhitespace: true,
      typoTolerance: 0,
    };
    expect(gradeResponse(interaction, { type: "text_input", value: "дискриминанта" }, POINTS).score).toBe(POINTS);
    expect(gradeResponse(interaction, { type: "text_input", value: "дискриминантом" }, POINTS).score).toBe(POINTS);
    expect(gradeResponse(interaction, { type: "text_input", value: "дискриминантов" }, POINTS).score).toBe(0);
  });

  it("typoTolerance: расстояние Левенштейна в пределах допуска — верно, за пределами — нет (граница)", () => {
    const interaction: QuestionInteraction = {
      type: "text_input",
      answers: [{ value: "дискриминант", match: "exact" }],
      caseSensitive: false,
      trimWhitespace: true,
      typoTolerance: 1,
    };
    // "дискриминаит" — одна замена буквы, расстояние 1 — на границе допуска.
    expect(gradeResponse(interaction, { type: "text_input", value: "дискриминаит" }, POINTS).score).toBe(POINTS);
    // "дискриминаиы" — две замены, расстояние 2 — за пределами допуска 1.
    expect(gradeResponse(interaction, { type: "text_input", value: "дискриминаиы" }, POINTS).score).toBe(0);
  });

  it("typoTolerance: не применяется к regex — опечатка в шаблоне не имеет смысла как понятие", () => {
    const interaction: QuestionInteraction = {
      type: "text_input",
      answers: [{ value: "^ровно10$", match: "regex" }],
      caseSensitive: false,
      trimWhitespace: true,
      typoTolerance: 5,
    };
    // Даже с большим typoTolerance "ровно20" не подходит под regex — допуск сюда не просачивается.
    expect(gradeResponse(interaction, { type: "text_input", value: "ровно20" }, POINTS).score).toBe(0);
  });

  it("несколько вариантов ответа — достаточно совпадения с любым одним", () => {
    const interaction: QuestionInteraction = {
      type: "text_input",
      answers: [
        { value: "дискриминант", match: "exact" },
        { value: "D", match: "exact" },
      ],
      caseSensitive: true,
      trimWhitespace: true,
      typoTolerance: 0,
    };
    expect(gradeResponse(interaction, { type: "text_input", value: "D" }, POINTS).score).toBe(POINTS);
  });
});

describe("gradeResponse: numeric_input — допуски absolute/relative/percent, unitRequired", () => {
  it("absolute: в пределах допуска — верно, на грани — верно, за гранью — нет", () => {
    const interaction: QuestionInteraction = {
      type: "numeric_input",
      value: 10,
      tolerance: { kind: "absolute", value: 0.5 },
      unitRequired: false,
    };
    expect(gradeResponse(interaction, { type: "numeric_input", value: 10.5 }, POINTS).score).toBe(POINTS);
    expect(gradeResponse(interaction, { type: "numeric_input", value: 10.51 }, POINTS).score).toBe(0);
  });

  it("relative: допуск — доля от правильного значения", () => {
    const interaction: QuestionInteraction = {
      type: "numeric_input",
      value: 9.81,
      tolerance: { kind: "relative", value: 0.01 }, // ±1% от 9.81 ≈ ±0.0981
      unitRequired: false,
    };
    expect(gradeResponse(interaction, { type: "numeric_input", value: 9.85 }, POINTS).score).toBe(POINTS);
    expect(gradeResponse(interaction, { type: "numeric_input", value: 9.95 }, POINTS).score).toBe(0);
  });

  it("percent: то же самое, что relative, но value в процентах", () => {
    const interaction: QuestionInteraction = {
      type: "numeric_input",
      value: 100,
      tolerance: { kind: "percent", value: 5 }, // ±5%
      unitRequired: false,
    };
    expect(gradeResponse(interaction, { type: "numeric_input", value: 104 }, POINTS).score).toBe(POINTS);
    expect(gradeResponse(interaction, { type: "numeric_input", value: 106 }, POINTS).score).toBe(0);
  });

  it("unitRequired: верное число без единицы — не засчитывается", () => {
    const interaction: QuestionInteraction = {
      type: "numeric_input",
      value: 9.81,
      tolerance: { kind: "absolute", value: 0.01 },
      unit: "м/с²",
      unitRequired: true,
    };
    expect(gradeResponse(interaction, { type: "numeric_input", value: 9.81 }, POINTS).score).toBe(0);
    expect(gradeResponse(interaction, { type: "numeric_input", value: 9.81, unit: "м/с²" }, POINTS).score).toBe(POINTS);
    expect(gradeResponse(interaction, { type: "numeric_input", value: 9.81, unit: "кг" }, POINTS).score).toBe(0);
  });

  it("значение не введено (null) — 0, не исключение", () => {
    const interaction: QuestionInteraction = {
      type: "numeric_input",
      value: 9.81,
      tolerance: { kind: "absolute", value: 0.01 },
      unitRequired: false,
    };
    expect(gradeResponse(interaction, { type: "numeric_input", value: null }, POINTS).score).toBe(0);
  });
});

describe("gradeResponse: open_answer — ручная проверка (§6.4 ТЗ)", () => {
  it("не выставляет баллы сам, correct: null, autoGraded: false", () => {
    const interaction: QuestionInteraction = {
      type: "open_answer",
      maxLength: 2000,
      allowAttachments: false,
      rubric: [{ id: "c1", label: "Критерий", points: 1 }],
    };
    const response: QuestionResponse = { type: "open_answer", text: "Развёрнутый ответ ученика", attachmentIds: [] };
    expect(gradeResponse(interaction, response, POINTS)).toEqual({
      score: 0,
      maxScore: POINTS,
      correct: null,
      autoGraded: false,
    });
  });
});

describe("gradeResponse: cloze_dropdown — частичные баллы, незаполненный пропуск не штрафуется", () => {
  const interaction: QuestionInteraction = {
    type: "cloze_dropdown",
    template: "Столица Франции — {{g1}}, столица Италии — {{g2}}.",
    gaps: {
      g1: { options: ["Париж", "Лион", "Марсель"], correct: "Париж" },
      g2: { options: ["Рим", "Милан", "Неаполь"], correct: "Рим" },
    },
  };

  it("оба пропуска верны — полный балл", () => {
    const response: QuestionResponse = { type: "cloze_dropdown", values: { g1: "Париж", g2: "Рим" } };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(POINTS);
  });

  it("один верный, один неверный — (1-1)/2 = 0", () => {
    const response: QuestionResponse = { type: "cloze_dropdown", values: { g1: "Париж", g2: "Милан" } };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(0);
  });

  it("один верный, один не заполнен (null) — незаполненный не штрафуется: (1-0)/2", () => {
    const response: QuestionResponse = { type: "cloze_dropdown", values: { g1: "Париж", g2: null } };
    expect(gradeResponse(interaction, response, POINTS).score).toBeCloseTo(POINTS / 2);
  });
});

describe("gradeResponse: cloze_text — те же правила сопоставления, что text_input, но по каждому пропуску", () => {
  const interaction: QuestionInteraction = {
    type: "cloze_text",
    template: "2 + 2 = {{g1}}",
    gaps: {
      g1: { answers: [{ value: "4", match: "exact" }], caseSensitive: false, trimWhitespace: true, typoTolerance: 0 },
    },
  };

  it("верный ответ в пропуске — полный балл", () => {
    const response: QuestionResponse = { type: "cloze_text", values: { g1: "4" } };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(POINTS);
  });

  it("пустая строка в пропуске — не штрафуется, но и не засчитывается", () => {
    const response: QuestionResponse = { type: "cloze_text", values: { g1: "" } };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(0);
    expect(gradeResponse(interaction, response, POINTS).correct).toBe(false);
  });
});

describe("gradeResponse: matching — all_or_nothing и partial", () => {
  const baseInteraction = {
    type: "matching" as const,
    left: [
      { id: "l1", html: "H₂O" },
      { id: "l2", html: "NaCl" },
    ],
    right: [
      { id: "r1", html: "вода" },
      { id: "r2", html: "соль" },
    ],
    pairs: [
      ["l1", "r1"],
      ["l2", "r2"],
    ] as [string, string][],
    distractors: [],
  };

  it("all_or_nothing: обе пары верны — полный балл", () => {
    const interaction: QuestionInteraction = { ...baseInteraction, scoring: "all_or_nothing" };
    const response: QuestionResponse = {
      type: "matching",
      pairs: [
        ["l1", "r1"],
        ["l2", "r2"],
      ],
    };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(POINTS);
  });

  it("all_or_nothing: одна пара неверна — 0, а не частичный балл", () => {
    const interaction: QuestionInteraction = { ...baseInteraction, scoring: "all_or_nothing" };
    const response: QuestionResponse = {
      type: "matching",
      pairs: [
        ["l1", "r1"],
        ["l2", "r1"],
      ],
    };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(0);
  });

  it("partial: одна из двух пар верна — (1-1)/2 = 0 (вторая пара неверна и штрафует)", () => {
    const interaction: QuestionInteraction = { ...baseInteraction, scoring: "partial" };
    const response: QuestionResponse = {
      type: "matching",
      pairs: [
        ["l1", "r1"],
        ["l2", "r1"],
      ],
    };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(0);
  });

  it("partial: только одна пара указана и она верна — (1-0)/2", () => {
    const interaction: QuestionInteraction = { ...baseInteraction, scoring: "partial" };
    const response: QuestionResponse = { type: "matching", pairs: [["l1", "r1"]] };
    expect(gradeResponse(interaction, response, POINTS).score).toBeCloseTo(POINTS / 2);
  });
});

describe("gradeResponse: ordering — all-or-nothing (не входит в список частичных баллов §6.4 ТЗ)", () => {
  const interaction: QuestionInteraction = {
    type: "ordering",
    items: [
      { id: "1", html: "Первый" },
      { id: "2", html: "Второй" },
      { id: "3", html: "Третий" },
    ],
  };

  it("порядок совпадает полностью — полный балл", () => {
    const response: QuestionResponse = { type: "ordering", order: ["1", "2", "3"] };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(POINTS);
  });

  it("переставлены местами два соседних элемента — 0, не частичный балл", () => {
    const response: QuestionResponse = { type: "ordering", order: ["1", "3", "2"] };
    expect(gradeResponse(interaction, response, POINTS)).toEqual({
      score: 0,
      maxScore: POINTS,
      correct: false,
      autoGraded: true,
    });
  });
});

describe("gradeResponse: categorize — частичные баллы, как cloze_*/matching (§6.4 ТЗ, тип 11, Э13)", () => {
  const interaction: QuestionInteraction = {
    type: "categorize",
    shuffle: false,
    categories: [
      { id: "metals", label: "Металлы" },
      { id: "nonmetals", label: "Неметаллы" },
    ],
    items: [
      { id: "i1", html: "Натрий", categoryId: "metals" },
      { id: "i2", html: "Железо", categoryId: "metals" },
      { id: "i3", html: "Кислород", categoryId: "nonmetals" },
    ],
  };

  it("все элементы разложены верно — полный балл", () => {
    const response: QuestionResponse = {
      type: "categorize",
      values: { i1: "metals", i2: "metals", i3: "nonmetals" },
    };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(POINTS);
  });

  it("два верных, один неверный из трёх — (2-1)/3", () => {
    const response: QuestionResponse = {
      type: "categorize",
      values: { i1: "metals", i2: "nonmetals", i3: "nonmetals" },
    };
    expect(gradeResponse(interaction, response, POINTS).score).toBeCloseTo((POINTS * 1) / 3);
  });

  it("один верный, один не размещён (null) — незаполненный не штрафуется: (1-0)/3", () => {
    const response: QuestionResponse = {
      type: "categorize",
      values: { i1: "metals", i2: null, i3: "nonmetals" },
    };
    expect(gradeResponse(interaction, response, POINTS).score).toBeCloseTo((POINTS * 2) / 3);
  });

  it("все неверны — 0, не отрицательный балл", () => {
    const response: QuestionResponse = {
      type: "categorize",
      values: { i1: "nonmetals", i2: "nonmetals", i3: "metals" },
    };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(0);
  });
});

describe("gradeResponse: highlight_text — частичные баллы, как multiple_choice (§6.3 ТЗ тип 14, Э13)", () => {
  const interaction: QuestionInteraction = {
    type: "highlight_text",
    tokens: [
      { id: "t1", text: "Дети", correct: false },
      { id: "t2", text: "весело", correct: false },
      { id: "t3", text: "играли", correct: true },
      { id: "t4", text: "во", correct: false },
      { id: "t5", text: "дворе", correct: false },
    ],
  };

  it("выделен ровно верный токен — полный балл", () => {
    const response: QuestionResponse = { type: "highlight_text", selectedIds: ["t3"] };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(POINTS);
  });

  it("выделен верный + один лишний — (1-1)/1 = 0", () => {
    const response: QuestionResponse = { type: "highlight_text", selectedIds: ["t3", "t1"] };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(0);
  });

  it("ничего не выделено — 0", () => {
    const response: QuestionResponse = { type: "highlight_text", selectedIds: [] };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(0);
  });
});

describe("gradeResponse: table_fill — частичные баллы, как cloze_text (§6.3 ТЗ тип 16, Э13)", () => {
  const interaction: QuestionInteraction = {
    type: "table_fill",
    rows: [
      [
        { kind: "static", text: "H₂O" },
        { kind: "input", id: "c1", answers: [{ value: "вода", match: "normalized" }], caseSensitive: false, trimWhitespace: true, typoTolerance: 0 },
      ],
      [
        { kind: "static", text: "NaCl" },
        { kind: "input", id: "c2", answers: [{ value: "соль", match: "normalized" }], caseSensitive: false, trimWhitespace: true, typoTolerance: 0 },
      ],
    ],
  };

  it("обе ячейки верны — полный балл", () => {
    const response: QuestionResponse = { type: "table_fill", values: { c1: "вода", c2: "соль" } };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(POINTS);
  });

  it("одна верна, одна неверна — (1-1)/2 = 0", () => {
    const response: QuestionResponse = { type: "table_fill", values: { c1: "вода", c2: "сахар" } };
    expect(gradeResponse(interaction, response, POINTS).score).toBe(0);
  });

  it("одна верна, одна не заполнена — незаполненная не штрафует: (1-0)/2", () => {
    const response: QuestionResponse = { type: "table_fill", values: { c1: "вода", c2: "" } };
    expect(gradeResponse(interaction, response, POINTS).score).toBeCloseTo(POINTS / 2);
  });
});

describe("gradeResponse: несовпадение типов — программная ошибка вызывающей стороны", () => {
  it("бросает исключение, а не тихо возвращает 0", () => {
    const interaction: QuestionInteraction = { type: "true_false", correct: true };
    const response: QuestionResponse = { type: "single_choice", selectedOptionId: "o1" };
    expect(() => gradeResponse(interaction, response, POINTS)).toThrow();
  });
});
