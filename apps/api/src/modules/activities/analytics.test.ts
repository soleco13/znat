import { describe, expect, it } from "vitest";
import type { QuestionInteraction, QuestionResponse } from "@school/shared";
import { buildDistribution, formatResponseText } from "./analytics.js";

describe("buildDistribution (Э8.9)", () => {
  it("single_choice — «сколько выбрали каждый вариант» + подсветка верного", () => {
    const interaction: QuestionInteraction = {
      type: "single_choice",
      shuffle: false,
      options: [
        { id: "a", html: "A", correct: false },
        { id: "b", html: "B", correct: true },
        { id: "c", html: "C", correct: false },
      ],
    };
    const responses: QuestionResponse[] = [
      { type: "single_choice", selectedOptionId: "b" },
      { type: "single_choice", selectedOptionId: "b" },
      { type: "single_choice", selectedOptionId: "a" },
      { type: "single_choice", selectedOptionId: null },
    ];
    const dist = buildDistribution(interaction, responses);
    expect(dist).toEqual({
      kind: "choice",
      bars: [
        { key: "a", label: "A", count: 1, correct: false },
        { key: "b", label: "B", count: 2, correct: true },
        { key: "c", label: "C", count: 0, correct: false },
      ],
    });
  });

  it("multiple_choice — считает каждый выбранный вариант отдельно", () => {
    const interaction: QuestionInteraction = {
      type: "multiple_choice",
      shuffle: false,
      options: [
        { id: "x", html: "X", correct: true },
        { id: "y", html: "Y", correct: true },
        { id: "z", html: "Z", correct: false },
      ],
    };
    const responses: QuestionResponse[] = [
      { type: "multiple_choice", selectedOptionIds: ["x", "y"] },
      { type: "multiple_choice", selectedOptionIds: ["x", "z"] },
    ];
    const dist = buildDistribution(interaction, responses);
    expect(dist.kind).toBe("choice");
    if (dist.kind !== "choice") throw new Error("unreachable");
    expect(dist.bars.map((b) => b.count)).toEqual([2, 1, 1]);
  });

  it("true_false — два столбца, верный помечен", () => {
    const interaction: QuestionInteraction = { type: "true_false", correct: false };
    const responses: QuestionResponse[] = [
      { type: "true_false", value: true },
      { type: "true_false", value: false },
      { type: "true_false", value: false },
      { type: "true_false", value: null },
    ];
    const dist = buildDistribution(interaction, responses);
    expect(dist).toEqual({
      kind: "choice",
      bars: [
        { key: "true", label: "Верно", count: 1, correct: false },
        { key: "false", label: "Неверно", count: 2, correct: true },
      ],
    });
  });

  it("text_input — топ различных ответов, лишние в otherDistinct", () => {
    const interaction: QuestionInteraction = {
      type: "text_input",
      answers: [{ value: "Париж", match: "exact" }],
      caseSensitive: false,
      trimWhitespace: true,
      typoTolerance: 0,
    };
    const responses: QuestionResponse[] = [
      { type: "text_input", value: "Париж" },
      { type: "text_input", value: " Париж " },
      { type: "text_input", value: "Лион" },
      { type: "text_input", value: "" },
    ];
    const dist = buildDistribution(interaction, responses);
    expect(dist.kind).toBe("text");
    if (dist.kind !== "text") throw new Error("unreachable");
    // "Париж" x1 + " Париж " не тримится в exact-режиме → это разные ключи? topText тримит всегда.
    expect(dist.bars.find((b) => b.key === "Париж")?.count).toBe(2);
    expect(dist.bars.find((b) => b.key === "Лион")?.count).toBe(1);
  });

  it("cloze_dropdown — распределение по каждому пропуску с верным вариантом", () => {
    const interaction: QuestionInteraction = {
      type: "cloze_dropdown",
      template: "{{g1}} и {{g2}}",
      gaps: {
        g1: { options: ["Париж", "Лион"], correct: "Париж" },
        g2: { options: ["Рим", "Милан"], correct: "Рим" },
      },
    };
    const responses: QuestionResponse[] = [
      { type: "cloze_dropdown", values: { g1: "Париж", g2: "Милан" } },
      { type: "cloze_dropdown", values: { g1: "Париж", g2: "Рим" } },
    ];
    const dist = buildDistribution(interaction, responses);
    expect(dist.kind).toBe("gaps");
    if (dist.kind !== "gaps") throw new Error("unreachable");
    const g1 = dist.gaps.find((g) => g.gapId === "g1")!;
    expect(g1.bars).toEqual([
      { key: "Париж", label: "Париж", count: 2, correct: true },
      { key: "Лион", label: "Лион", count: 0, correct: false },
    ]);
  });

  it("ordering — только сводка верно/частично/неверно", () => {
    const interaction: QuestionInteraction = {
      type: "ordering",
      items: [
        { id: "1", html: "один" },
        { id: "2", html: "два" },
        { id: "3", html: "три" },
      ],
    };
    const responses: QuestionResponse[] = [
      { type: "ordering", order: ["1", "2", "3"] },
      { type: "ordering", order: ["3", "2", "1"] },
    ];
    const dist = buildDistribution(interaction, responses);
    expect(dist).toEqual({ kind: "summary", correctCount: 1, partialCount: 0, incorrectCount: 1 });
  });
});

describe("formatResponseText (Э8.10) — текст ответа для «вынести на доску»", () => {
  it("single_choice — подпись выбранного варианта, без разметки", () => {
    const interaction: QuestionInteraction = {
      type: "single_choice",
      shuffle: false,
      options: [{ id: "a", html: "<b>4</b>", correct: true }],
    };
    expect(formatResponseText(interaction, { type: "single_choice", selectedOptionId: "a" })).toBe("4");
    expect(formatResponseText(interaction, { type: "single_choice", selectedOptionId: null })).toBe("(нет ответа)");
  });

  it("multiple_choice — через запятую", () => {
    const interaction: QuestionInteraction = {
      type: "multiple_choice",
      shuffle: false,
      options: [
        { id: "x", html: "X", correct: true },
        { id: "y", html: "Y", correct: true },
        { id: "z", html: "Z", correct: false },
      ],
    };
    expect(
      formatResponseText(interaction, { type: "multiple_choice", selectedOptionIds: ["x", "z"] }),
    ).toBe("X, Z");
  });

  it("true_false", () => {
    const interaction: QuestionInteraction = { type: "true_false", correct: true };
    expect(formatResponseText(interaction, { type: "true_false", value: true })).toBe("Верно");
    expect(formatResponseText(interaction, { type: "true_false", value: false })).toBe("Неверно");
    expect(formatResponseText(interaction, { type: "true_false", value: null })).toBe("(нет ответа)");
  });

  it("text_input / open_answer — как есть, пустое → «нет ответа»", () => {
    const textInteraction: QuestionInteraction = {
      type: "text_input",
      answers: [{ value: "Париж", match: "exact" }],
      caseSensitive: false,
      trimWhitespace: true,
      typoTolerance: 0,
    };
    expect(formatResponseText(textInteraction, { type: "text_input", value: "Париж" })).toBe("Париж");
    expect(formatResponseText(textInteraction, { type: "text_input", value: "  " })).toBe("(нет ответа)");
  });

  it("numeric_input — с единицей, если есть", () => {
    const interaction: QuestionInteraction = {
      type: "numeric_input",
      value: 5,
      tolerance: { kind: "absolute", value: 0 },
      unit: "см",
      unitRequired: false,
    };
    expect(formatResponseText(interaction, { type: "numeric_input", value: 5, unit: "см" })).toBe("5 см");
    expect(formatResponseText(interaction, { type: "numeric_input", value: null })).toBe("(нет ответа)");
  });

  it("cloze_dropdown / cloze_text — по строке на пропуск", () => {
    const interaction: QuestionInteraction = {
      type: "cloze_dropdown",
      template: "{{g1}}",
      gaps: { g1: { options: ["A", "B"], correct: "A" } },
    };
    expect(formatResponseText(interaction, { type: "cloze_dropdown", values: { g1: "B" } })).toBe("g1: B");
    expect(formatResponseText(interaction, { type: "cloze_dropdown", values: { g1: null } })).toBe("g1: —");
  });

  it("matching — «слева → справа», без разметки", () => {
    const interaction: QuestionInteraction = {
      type: "matching",
      left: [{ id: "l1", html: "<i>Кот</i>" }],
      right: [{ id: "r1", html: "Мяу" }],
      pairs: [["l1", "r1"]],
      scoring: "all_or_nothing",
      distractors: [],
    };
    expect(formatResponseText(interaction, { type: "matching", pairs: [["l1", "r1"]] })).toBe("Кот → Мяу");
    expect(formatResponseText(interaction, { type: "matching", pairs: [] })).toBe("(нет ответа)");
  });

  it("ordering — нумерованный список в порядке ответа ученика", () => {
    const interaction: QuestionInteraction = {
      type: "ordering",
      items: [
        { id: "1", html: "один" },
        { id: "2", html: "два" },
      ],
    };
    expect(formatResponseText(interaction, { type: "ordering", order: ["2", "1"] })).toBe("1. два\n2. один");
  });
});
