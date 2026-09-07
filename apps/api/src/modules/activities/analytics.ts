import type {
  AnalyticsBar,
  QuestionDistribution,
  QuestionInteraction,
  QuestionResponse,
  TextDistribution,
} from "@school/shared";
import { gradeResponse } from "../materials/service.js";

/**
 * Агрегация ответов класса по одному вопросу (Э8.9, §7.3 ТЗ: «17 из 24
 * выбрали B»). Класс-масштаб, всё в памяти. `interaction` — ПОЛНЫЙ (с ключом
 * ответа): аналитику видит только учитель, и подсветка верного варианта —
 * весь смысл разбора.
 *
 * `responses` — уже отфильтрованы по этому вопросу и сужены по `type`
 * вызывающей стороной (`response.type === interaction.type`).
 */
const TEXT_TOP = 8;

export function buildDistribution(
  interaction: QuestionInteraction,
  responses: QuestionResponse[],
): QuestionDistribution {
  switch (interaction.type) {
    case "single_choice": {
      const rs = responses as Extract<QuestionResponse, { type: "single_choice" }>[];
      return {
        kind: "choice",
        bars: interaction.options.map((o) => ({
          key: o.id,
          label: o.html,
          count: rs.filter((r) => r.selectedOptionId === o.id).length,
          correct: o.correct,
        })),
      };
    }

    case "multiple_choice": {
      const rs = responses as Extract<QuestionResponse, { type: "multiple_choice" }>[];
      return {
        kind: "choice",
        bars: interaction.options.map((o) => ({
          key: o.id,
          label: o.html,
          count: rs.filter((r) => r.selectedOptionIds.includes(o.id)).length,
          correct: o.correct,
        })),
      };
    }

    case "true_false": {
      const rs = responses as Extract<QuestionResponse, { type: "true_false" }>[];
      return {
        kind: "choice",
        bars: [
          { key: "true", label: "Верно", count: rs.filter((r) => r.value === true).length, correct: interaction.correct === true },
          { key: "false", label: "Неверно", count: rs.filter((r) => r.value === false).length, correct: interaction.correct === false },
        ],
      };
    }

    case "text_input": {
      const rs = responses as Extract<QuestionResponse, { type: "text_input" }>[];
      return topText(rs.map((r) => r.value));
    }

    case "numeric_input": {
      const rs = responses as Extract<QuestionResponse, { type: "numeric_input" }>[];
      return topText(
        rs
          .filter((r) => r.value !== null)
          .map((r) => (r.unit ? `${r.value} ${r.unit}` : String(r.value))),
      );
    }

    case "open_answer": {
      const rs = responses as Extract<QuestionResponse, { type: "open_answer" }>[];
      return topText(rs.map((r) => r.text));
    }

    case "cloze_dropdown": {
      const rs = responses as Extract<QuestionResponse, { type: "cloze_dropdown" }>[];
      return {
        kind: "gaps",
        gaps: Object.entries(interaction.gaps).map(([gapId, gap]) => ({
          gapId,
          bars: gap.options.map((opt) => ({
            key: opt,
            label: opt,
            count: rs.filter((r) => r.values[gapId] === opt).length,
            correct: opt === gap.correct,
          })),
        })),
      };
    }

    case "cloze_text": {
      const rs = responses as Extract<QuestionResponse, { type: "cloze_text" }>[];
      return {
        kind: "gaps",
        gaps: Object.keys(interaction.gaps).map((gapId) => ({
          gapId,
          bars: topText(rs.map((r) => r.values[gapId] ?? "")).bars,
        })),
      };
    }

    case "matching":
    case "ordering":
    case "categorize":
    case "highlight_text":
    case "table_fill":
      return summarize(interaction, responses);
  }
}

/** Топ различных ответов свободного ввода (§7.3 ТЗ — увидеть типичные ошибки). Ключ — тримленное значение, верность к столбцам не применяем. */
function topText(values: string[]): TextDistribution {
  const counts = new Map<string, { label: string; count: number }>();
  for (const raw of values) {
    const key = raw.trim();
    if (key === "") continue;
    const entry = counts.get(key) ?? { label: key.length > 80 ? `${key.slice(0, 80)}…` : key, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  const bars: AnalyticsBar[] = sorted.slice(0, TEXT_TOP).map(([key, v]) => ({
    key,
    label: v.label,
    count: v.count,
    correct: null,
  }));
  return { kind: "text", bars, otherDistinct: Math.max(0, sorted.length - TEXT_TOP) };
}

/** Убирает разметку из `html`-фрагментов интеракции (варианты/пары) — текст на доске (Э8.10) простой, не HTML. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/**
 * Человекочитаемый текст одного ответа ученика — для «вынести ответ на
 * доску» (Э8.10, §7.3 ТЗ). `interaction` ПОЛНЫЙ (с ключом ответа, как и в
 * `buildDistribution` выше) — нужен для подписи вариантов/пар по их `id`,
 * само значение верности сюда не подмешивается (на доску идёт то, что
 * написал ученик, без пометки «верно/неверно» — это решает контекст
 * разбора, не текст элемента). `response.type` уже сверен с
 * `interaction.type` вызывающей стороной, как и везде в этом модуле.
 */
export function formatResponseText(interaction: QuestionInteraction, response: QuestionResponse): string {
  switch (interaction.type) {
    case "single_choice": {
      const r = response as Extract<QuestionResponse, { type: "single_choice" }>;
      const opt = interaction.options.find((o) => o.id === r.selectedOptionId);
      return opt ? stripHtml(opt.html) : "(нет ответа)";
    }
    case "multiple_choice": {
      const r = response as Extract<QuestionResponse, { type: "multiple_choice" }>;
      const opts = interaction.options.filter((o) => r.selectedOptionIds.includes(o.id));
      return opts.length > 0 ? opts.map((o) => stripHtml(o.html)).join(", ") : "(нет ответа)";
    }
    case "true_false": {
      const r = response as Extract<QuestionResponse, { type: "true_false" }>;
      return r.value === null ? "(нет ответа)" : r.value ? "Верно" : "Неверно";
    }
    case "text_input": {
      const r = response as Extract<QuestionResponse, { type: "text_input" }>;
      return r.value.trim() || "(нет ответа)";
    }
    case "numeric_input": {
      const r = response as Extract<QuestionResponse, { type: "numeric_input" }>;
      if (r.value === null) return "(нет ответа)";
      return r.unit ? `${r.value} ${r.unit}` : String(r.value);
    }
    case "open_answer": {
      const r = response as Extract<QuestionResponse, { type: "open_answer" }>;
      return r.text.trim() || "(нет ответа)";
    }
    case "cloze_dropdown": {
      const r = response as Extract<QuestionResponse, { type: "cloze_dropdown" }>;
      return Object.entries(r.values)
        .map(([gapId, value]) => `${gapId}: ${value ?? "—"}`)
        .join("\n");
    }
    case "cloze_text": {
      const r = response as Extract<QuestionResponse, { type: "cloze_text" }>;
      return Object.entries(r.values)
        .map(([gapId, value]) => `${gapId}: ${value || "—"}`)
        .join("\n");
    }
    case "matching": {
      const r = response as Extract<QuestionResponse, { type: "matching" }>;
      const leftById = new Map(interaction.left.map((i) => [i.id, stripHtml(i.html)]));
      const rightById = new Map(interaction.right.map((i) => [i.id, stripHtml(i.html)]));
      if (r.pairs.length === 0) return "(нет ответа)";
      return r.pairs.map(([l, right]) => `${leftById.get(l) ?? l} → ${rightById.get(right) ?? right}`).join("\n");
    }
    case "ordering": {
      const r = response as Extract<QuestionResponse, { type: "ordering" }>;
      const byId = new Map(interaction.items.map((i) => [i.id, stripHtml(i.html)]));
      if (r.order.length === 0) return "(нет ответа)";
      return r.order.map((id, i) => `${i + 1}. ${byId.get(id) ?? id}`).join("\n");
    }
    case "categorize": {
      const r = response as Extract<QuestionResponse, { type: "categorize" }>;
      const itemById = new Map(interaction.items.map((i) => [i.id, stripHtml(i.html)]));
      const categoryById = new Map(interaction.categories.map((c) => [c.id, c.label]));
      const placed = Object.entries(r.values).filter((entry): entry is [string, string] => entry[1] != null);
      if (placed.length === 0) return "(нет ответа)";
      return placed
        .map(([itemId, categoryId]) => `${itemById.get(itemId) ?? itemId} → ${categoryById.get(categoryId) ?? categoryId}`)
        .join("\n");
    }
    case "highlight_text": {
      const r = response as Extract<QuestionResponse, { type: "highlight_text" }>;
      const selected = new Set(r.selectedIds);
      const words = interaction.tokens.map((t) => (selected.has(t.id) ? `[${stripHtml(t.text)}]` : stripHtml(t.text)));
      return selected.size === 0 ? "(нет ответа)" : words.join(" ");
    }
    case "table_fill": {
      const r = response as Extract<QuestionResponse, { type: "table_fill" }>;
      const inputCells = interaction.rows.flat().filter((c) => c.kind === "input");
      const filled = inputCells.filter((c) => r.values[c.id]);
      if (filled.length === 0) return "(нет ответа)";
      return filled.map((c, i) => `${i + 1}. ${r.values[c.id]}`).join("\n");
    }
  }
}

/** `matching`/`ordering` — гистограммы вариантов нет, только «верно / частично / неверно» через движок проверки (Э8.3). */
function summarize(interaction: QuestionInteraction, responses: QuestionResponse[]): QuestionDistribution {
  let correctCount = 0;
  let partialCount = 0;
  let incorrectCount = 0;
  for (const r of responses) {
    const { score, maxScore } = gradeResponse(interaction, r, 1);
    if (maxScore > 0 && score >= maxScore) correctCount += 1;
    else if (score > 0) partialCount += 1;
    else incorrectCount += 1;
  }
  return { kind: "summary", correctCount, partialCount, incorrectCount };
}
