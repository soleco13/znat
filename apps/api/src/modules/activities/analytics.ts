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
