import { describe, expect, it } from "vitest";
import type { QuestionInteraction, QuestionResponse } from "@school/shared";
import { buildDistribution } from "./analytics.js";

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
