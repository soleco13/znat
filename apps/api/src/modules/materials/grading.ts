import type { GradeResult, QuestionInteraction, QuestionResponse, TextMatchRule } from "@school/shared";

/**
 * Движок проверки (Э8.3, §6.3/§6.4 ТЗ). ЧИТАТЬ ПОСТРОЧНО (§ «Что не
 * делегировать вслепую» CLAUDE.md, дословно из ПЛАН.md: «единственное
 * место, где баг тихо портит оценки учеников, и никакой MCP этого не
 * поймает»). Каждый тип — отдельная функция, без общей «умной» абстракции
 * поверх дискриминированного объединения: одна ошибка в общей формуле
 * задела бы сразу все 10 типов молча, отдельные функции ошибаются
 * порознь и заметно (табличные тесты Э8.3 ниже проверяют каждую отдельно).
 *
 * §6.4 ТЗ, частичные баллы — ТОЛЬКО для `multiple_choice`, `matching`,
 * `cloze_dropdown`, `cloze_text` (в ТЗ ещё `categorize`, типа 11, здесь нет
 * — стоп-лист Э8). Формула дословно: `max(0, (верных − неверных) / всего)`.
 * `ordering` в этот список НЕ входит — там либо весь порядок верен, либо
 * нет (all-or-nothing), это явно следует из ОТСУТСТВИЯ `ordering` в
 * перечислении §6.4 ТЗ, не забывчивость.
 *
 * Несовпадение `interaction.type !== response.type` — это баг вызывающей
 * стороны (Э8.6, ещё не сделана) или подделанный запрос, не штатная
 * ситуация для движка: `gradeResponse` бросает исключение, а не тихо
 * возвращает 0 — тихий 0 неотличим от честного неверного ответа в логах.
 */

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function applyTextRules(raw: string, caseSensitive: boolean, trimWhitespace: boolean): string {
  let value = trimWhitespace ? raw.trim() : raw;
  if (!caseSensitive) value = value.toLowerCase();
  return value;
}

/**
 * Расстояние Левенштейна — классический DP, O(n·m). Вопросы короткие
 * (короткий текстовый ответ, §6.3 ТЗ), квадратичная сложность здесь не
 * узкое место.
 */
function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i]![0] = i;
  for (let j = 0; j < cols; j++) d[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1, // удаление
        d[i]![j - 1]! + 1, // вставка
        d[i - 1]![j - 1]! + cost, // замена
      );
    }
  }
  return d[rows - 1]![cols - 1]!;
}

/**
 * Проверка одного значения ответа против одного правила (§6.3 ТЗ,
 * `text_input`/`cloze_text`). `typoTolerance` (расстояние Левенштейна)
 * применяется ТОЛЬКО к `exact`/`normalized` — к `regex` не относится:
 * шаблон это точный синтаксис, «опечатка в регулярном выражении» не имеет
 * смысла как понятие пользовательского ответа. `normalized`, помимо
 * `caseSensitive`/`trimWhitespace`, дополнительно схлопывает повторные
 * пробелы внутри строки — то, что `exact` не делает (ТЗ не расписывает
 * разницу между `exact` и `normalized` явно, это разумное прочтение
 * названия режима, не факт из текста ТЗ).
 */
function matchesTextRule(
  studentValue: string,
  rule: TextMatchRule,
  caseSensitive: boolean,
  trimWhitespace: boolean,
  typoTolerance: number,
): boolean {
  if (rule.match === "regex") {
    const flags = caseSensitive ? "" : "i";
    const candidate = trimWhitespace ? studentValue.trim() : studentValue;
    return new RegExp(rule.value, flags).test(candidate);
  }

  const student =
    rule.match === "normalized"
      ? normalizeWhitespace(applyTextRules(studentValue, caseSensitive, trimWhitespace))
      : applyTextRules(studentValue, caseSensitive, trimWhitespace);
  const target =
    rule.match === "normalized"
      ? normalizeWhitespace(applyTextRules(rule.value, caseSensitive, trimWhitespace))
      : applyTextRules(rule.value, caseSensitive, trimWhitespace);

  if (student === target) return true;
  if (typoTolerance <= 0) return false;
  return levenshteinDistance(student, target) <= typoTolerance;
}

function fullOrZero(points: number, isCorrect: boolean): GradeResult {
  return { score: isCorrect ? points : 0, maxScore: points, correct: isCorrect, autoGraded: true };
}

/** Формула §6.4 ТЗ: `max(0, (верных − неверных) / всего)`. `total` — знаменатель, разный по смыслу для каждого типа (см. вызовы ниже). */
function partialCredit(points: number, correctCount: number, incorrectCount: number, total: number): GradeResult {
  const fraction = total > 0 ? Math.max(0, (correctCount - incorrectCount) / total) : 0;
  return { score: points * fraction, maxScore: points, correct: fraction >= 1, autoGraded: true };
}

export function gradeResponse(interaction: QuestionInteraction, response: QuestionResponse, points: number): GradeResult {
  if (interaction.type !== response.type) {
    throw new Error(
      `gradeResponse: interaction.type (${interaction.type}) не совпадает с response.type (${response.type})`,
    );
  }

  switch (interaction.type) {
    case "single_choice": {
      const r = response as Extract<QuestionResponse, { type: "single_choice" }>;
      const correctOption = interaction.options.find((o) => o.correct);
      return fullOrZero(points, r.selectedOptionId !== null && r.selectedOptionId === correctOption?.id);
    }

    case "multiple_choice": {
      const r = response as Extract<QuestionResponse, { type: "multiple_choice" }>;
      const correctIds = new Set(interaction.options.filter((o) => o.correct).map((o) => o.id));
      const selected = new Set(r.selectedOptionIds);
      let correctCount = 0;
      let incorrectCount = 0;
      for (const id of selected) {
        if (correctIds.has(id)) correctCount++;
        else incorrectCount++;
      }
      return partialCredit(points, correctCount, incorrectCount, correctIds.size);
    }

    case "true_false": {
      const r = response as Extract<QuestionResponse, { type: "true_false" }>;
      return fullOrZero(points, r.value !== null && r.value === interaction.correct);
    }

    case "text_input": {
      const r = response as Extract<QuestionResponse, { type: "text_input" }>;
      const isCorrect = interaction.answers.some((rule) =>
        matchesTextRule(r.value, rule, interaction.caseSensitive, interaction.trimWhitespace, interaction.typoTolerance),
      );
      return fullOrZero(points, isCorrect);
    }

    case "numeric_input": {
      const r = response as Extract<QuestionResponse, { type: "numeric_input" }>;
      if (r.value === null) return fullOrZero(points, false);
      if (interaction.unitRequired) {
        const studentUnit = (r.unit ?? "").trim();
        const expectedUnit = (interaction.unit ?? "").trim();
        if (studentUnit === "" || studentUnit !== expectedUnit) return fullOrZero(points, false);
      }
      const diff = Math.abs(r.value - interaction.value);
      const { kind, value: tol } = interaction.tolerance;
      const allowed =
        kind === "absolute" ? tol : kind === "relative" ? tol * Math.abs(interaction.value) : (tol / 100) * Math.abs(interaction.value);
      return fullOrZero(points, diff <= allowed);
    }

    case "open_answer":
      // §6.4 ТЗ: ручная проверка (типы 6/20/21) — попадает в очередь учителя
      // с рубрикой (Э8.12, ещё не сделана). Движок здесь сознательно НЕ
      // выставляет 0 как «неверно» — correct: null означает «не проверено».
      return { score: 0, maxScore: points, correct: null, autoGraded: false };

    case "cloze_dropdown": {
      const r = response as Extract<QuestionResponse, { type: "cloze_dropdown" }>;
      const gapIds = Object.keys(interaction.gaps);
      let correctCount = 0;
      let incorrectCount = 0;
      for (const gapId of gapIds) {
        const gap = interaction.gaps[gapId]!;
        const answer = r.values[gapId];
        if (answer == null) continue; // пропуск не заполнен — не засчитываем ни в верные, ни в неверные (см. докстринг файла)
        if (answer === gap.correct) correctCount++;
        else incorrectCount++;
      }
      return partialCredit(points, correctCount, incorrectCount, gapIds.length);
    }

    case "cloze_text": {
      const r = response as Extract<QuestionResponse, { type: "cloze_text" }>;
      const gapIds = Object.keys(interaction.gaps);
      let correctCount = 0;
      let incorrectCount = 0;
      for (const gapId of gapIds) {
        const gap = interaction.gaps[gapId]!;
        const answer = r.values[gapId];
        if (answer == null || answer === "") continue; // пропуск не заполнен
        const isCorrect = gap.answers.some((rule) =>
          matchesTextRule(answer, rule, gap.caseSensitive, gap.trimWhitespace, gap.typoTolerance),
        );
        if (isCorrect) correctCount++;
        else incorrectCount++;
      }
      return partialCredit(points, correctCount, incorrectCount, gapIds.length);
    }

    case "matching": {
      const r = response as Extract<QuestionResponse, { type: "matching" }>;
      const correctPairs = new Set(interaction.pairs.map(([l, right]) => `${l} ${right}`));
      let correctCount = 0;
      let incorrectCount = 0;
      for (const [l, right] of r.pairs) {
        if (correctPairs.has(`${l} ${right}`)) correctCount++;
        else incorrectCount++;
      }
      if (interaction.scoring === "all_or_nothing") {
        return fullOrZero(points, correctCount === interaction.pairs.length && incorrectCount === 0);
      }
      return partialCredit(points, correctCount, incorrectCount, interaction.pairs.length);
    }

    case "ordering": {
      // Не в списке частичных баллов §6.4 ТЗ — all-or-nothing (см. докстринг файла).
      const r = response as Extract<QuestionResponse, { type: "ordering" }>;
      const correctOrder = interaction.items.map((i) => i.id);
      const isCorrect = r.order.length === correctOrder.length && r.order.every((id, i) => id === correctOrder[i]);
      return fullOrZero(points, isCorrect);
    }
  }
}
