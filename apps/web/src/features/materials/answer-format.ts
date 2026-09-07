import type { QuestionInteraction, QuestionResponse } from "@school/shared";

/**
 * Форматирование ответов текстом — общее для разбора (`ReviewPanel`, Э8.10) и
 * просмотра попытки ученика учителем на уроке (`StudentAttemptView`, §7.3 ТЗ).
 * Тот же приём, что серверный `stripHtml`/`formatResponseText` в
 * `activities/analytics.ts`, но на клиенте: учитель и так имеет право видеть
 * и ключ ответа, и черновики учеников своего урока.
 */

/** Убирает разметку из вариантов/пар. */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/** Правильный ответ, текстом. */
export function formatCorrectAnswer(interaction: QuestionInteraction): string {
  switch (interaction.type) {
    case "single_choice":
    case "multiple_choice": {
      const correct = interaction.options.filter((o) => o.correct).map((o) => stripHtml(o.html));
      return correct.length > 0 ? correct.join(", ") : "—";
    }
    case "true_false":
      return interaction.correct ? "Верно" : "Неверно";
    case "text_input": {
      const literal = interaction.answers.filter((a) => a.match !== "regex").map((a) => a.value);
      return literal.length > 0 ? literal.join(" / ") : "—";
    }
    case "numeric_input":
      return interaction.unit ? `${interaction.value} ${interaction.unit}` : String(interaction.value);
    case "open_answer":
      return `по критериям: ${interaction.rubric.map((c) => c.label).join(", ")}`;
    case "cloze_dropdown":
      return Object.entries(interaction.gaps)
        .map(([gapId, gap]) => `${gapId}: ${gap.correct}`)
        .join("; ");
    case "cloze_text":
      return Object.entries(interaction.gaps)
        .map(([gapId, gap]) => {
          const literal = gap.answers.find((a) => a.match !== "regex");
          return `${gapId}: ${literal ? literal.value : "—"}`;
        })
        .join("; ");
    case "matching": {
      const leftById = new Map(interaction.left.map((i) => [i.id, stripHtml(i.html)]));
      const rightById = new Map(interaction.right.map((i) => [i.id, stripHtml(i.html)]));
      return interaction.pairs
        .map(([l, r]) => `${leftById.get(l) ?? l} → ${rightById.get(r) ?? r}`)
        .join("; ");
    }
    case "ordering":
      // Порядок элементов В МАССИВЕ и есть правильный ответ (см. materials.ts).
      return interaction.items.map((i) => stripHtml(i.html)).join(" → ");
    case "categorize": {
      const categoryById = new Map(interaction.categories.map((c) => [c.id, c.label]));
      return interaction.items
        .map((i) => `${stripHtml(i.html)} → ${categoryById.get(i.categoryId) ?? i.categoryId}`)
        .join("; ");
    }
    case "highlight_text":
      return interaction.tokens
        .filter((t) => t.correct)
        .map((t) => stripHtml(t.text))
        .join(", ") || "—";
    case "table_fill":
      return interaction.rows
        .flat()
        .filter((c) => c.kind === "input")
        .map((c) => c.answers.filter((a) => a.match !== "regex").map((a) => a.value).join(" / "))
        .join("; ") || "—";
  }
}

/** Ответ одного ученика, текстом. */
export function formatResponse(
  interaction: QuestionInteraction,
  response: QuestionResponse | undefined,
): string {
  if (!response) return "(нет ответа)";
  if (response.type !== interaction.type) return "(несоответствие типа)";
  switch (interaction.type) {
    case "single_choice": {
      const r = response as Extract<typeof response, { type: "single_choice" }>;
      const opt = interaction.options.find((o) => o.id === r.selectedOptionId);
      return opt ? stripHtml(opt.html) : "(нет ответа)";
    }
    case "multiple_choice": {
      const r = response as Extract<typeof response, { type: "multiple_choice" }>;
      const opts = interaction.options.filter((o) => r.selectedOptionIds.includes(o.id));
      return opts.length > 0 ? opts.map((o) => stripHtml(o.html)).join(", ") : "(нет ответа)";
    }
    case "true_false": {
      const r = response as Extract<typeof response, { type: "true_false" }>;
      return r.value === null ? "(нет ответа)" : r.value ? "Верно" : "Неверно";
    }
    case "text_input": {
      const r = response as Extract<typeof response, { type: "text_input" }>;
      return r.value.trim() || "(нет ответа)";
    }
    case "numeric_input": {
      const r = response as Extract<typeof response, { type: "numeric_input" }>;
      if (r.value === null) return "(нет ответа)";
      return r.unit ? `${r.value} ${r.unit}` : String(r.value);
    }
    case "open_answer": {
      const r = response as Extract<typeof response, { type: "open_answer" }>;
      return r.text.trim() || "(нет ответа)";
    }
    case "cloze_dropdown": {
      const r = response as Extract<typeof response, { type: "cloze_dropdown" }>;
      return Object.entries(r.values)
        .map(([gapId, v]) => `${gapId}: ${v ?? "—"}`)
        .join("; ");
    }
    case "cloze_text": {
      const r = response as Extract<typeof response, { type: "cloze_text" }>;
      return Object.entries(r.values)
        .map(([gapId, v]) => `${gapId}: ${v || "—"}`)
        .join("; ");
    }
    case "matching": {
      const r = response as Extract<typeof response, { type: "matching" }>;
      const leftById = new Map(interaction.left.map((i) => [i.id, stripHtml(i.html)]));
      const rightById = new Map(interaction.right.map((i) => [i.id, stripHtml(i.html)]));
      if (r.pairs.length === 0) return "(нет ответа)";
      return r.pairs
        .map(([l, right]) => `${leftById.get(l) ?? l} → ${rightById.get(right) ?? right}`)
        .join("; ");
    }
    case "ordering": {
      const r = response as Extract<typeof response, { type: "ordering" }>;
      const byId = new Map(interaction.items.map((i) => [i.id, stripHtml(i.html)]));
      if (r.order.length === 0) return "(нет ответа)";
      return r.order.map((id) => byId.get(id) ?? id).join(" → ");
    }
    case "categorize": {
      const r = response as Extract<typeof response, { type: "categorize" }>;
      const itemById = new Map(interaction.items.map((i) => [i.id, stripHtml(i.html)]));
      const categoryById = new Map(interaction.categories.map((c) => [c.id, c.label]));
      const placed = Object.entries(r.values).filter((entry): entry is [string, string] => entry[1] != null);
      if (placed.length === 0) return "(нет ответа)";
      return placed
        .map(([itemId, categoryId]) => `${itemById.get(itemId) ?? itemId} → ${categoryById.get(categoryId) ?? categoryId}`)
        .join("; ");
    }
    case "highlight_text": {
      const r = response as Extract<typeof response, { type: "highlight_text" }>;
      const selected = new Set(r.selectedIds);
      const words = interaction.tokens.filter((t) => selected.has(t.id)).map((t) => stripHtml(t.text));
      return words.length > 0 ? words.join(", ") : "(нет ответа)";
    }
    case "table_fill": {
      const r = response as Extract<typeof response, { type: "table_fill" }>;
      const inputCells = interaction.rows.flat().filter((c) => c.kind === "input");
      const filled = inputCells.filter((c) => r.values[c.id]);
      if (filled.length === 0) return "(нет ответа)";
      return filled.map((c) => r.values[c.id]).join("; ");
    }
  }
}
