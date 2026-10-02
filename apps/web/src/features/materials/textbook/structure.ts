import { type MaterialLayout, type QuestionResponse } from "@school/shared";

/**
 * Структура учебника поверх ПЛОСКОГО списка блоков материала. Ничего не
 * хранится: страницы, оглавление и нумерация — производное от `blocks` и
 * `settings.layout`, как и слайды (`paginateMaterial`).
 *
 * `slides`-материал делится на страницы-разделы (`splitSections`), `scroll`
 * идёт одной страницей. Позиция ученика и пометки учителя привязаны к id
 * блоков, а не к номеру страницы.
 */
export interface TextbookBlockLike {
  type: string;
  id: string;
  html?: string;
}

export interface TextbookPage {
  id: string;
  index: number;
  title: string;
  blockIds: string[];
  /** id блоков-заданий страницы, по порядку. */
  taskIds: string[];
}

export interface TextbookStructure {
  pages: TextbookPage[];
  /** Сквозной номер задания (с 1) по id блока. */
  taskNumber: Map<string, number>;
  /** Сквозной номер рисунка (с 1) по id блока-картинки. */
  figureNumber: Map<string, number>;
  /** Индекс страницы по id любого её блока. */
  pageOfBlock: Map<string, number>;
}

export function buildTextbook(
  blocks: readonly TextbookBlockLike[],
  layout: MaterialLayout,
): TextbookStructure {
  const taskNumber = new Map<string, number>();
  const figureNumber = new Map<string, number>();
  for (const b of blocks) {
    if (b.type === "question") taskNumber.set(b.id, taskNumber.size + 1);
    else if (b.type === "image") figureNumber.set(b.id, figureNumber.size + 1);
  }

  const byId = new Map(blocks.map((b) => [b.id, b]));
  const raw =
    layout === "slides"
      ? splitSections(blocks)
      : [blocks.filter((b) => b.type !== "page_break").map((b) => b.id)];

  const pageOfBlock = new Map<string, number>();
  const pages = raw
    .filter((ids) => ids.length > 0)
    .map((ids, index): TextbookPage => {
      for (const id of ids) pageOfBlock.set(id, index);
      const pageBlocks = ids.map((id) => byId.get(id)).filter((b) => b !== undefined);
      const taskIds = pageBlocks.filter((b) => b.type === "question").map((b) => b.id);
      return {
        id: ids[0]!,
        index,
        title: pageTitle(pageBlocks, taskIds, taskNumber, index),
        blockIds: ids,
        taskIds,
      };
    });

  return { pages, taskNumber, figureNumber, pageOfBlock };
}

/**
 * Страница учебника — раздел: граница там, где методист поставил разрыв
 * страницы, или перед заголовком h1/h2. Лимиты слайдов (`paginateMaterial`:
 * 8 блоков, 3 вопроса) здесь не нужны: страница прокручивается, и задание
 * не отрывается от текста, к которому относится.
 */
function splitSections(blocks: readonly TextbookBlockLike[]): string[][] {
  const pages: string[][] = [[]];
  for (const b of blocks) {
    const current = pages[pages.length - 1]!;
    if (b.type === "page_break") {
      if (current.length > 0) pages.push([]);
      continue;
    }
    if (current.length > 0 && b.type === "rich_text" && /^\s*<h[12][\s/>]/i.test(b.html ?? "")) {
      pages.push([b.id]);
      continue;
    }
    current.push(b.id);
  }
  return pages;
}

/**
 * Заголовок страницы для оглавления и навигации: первый заголовок h1–h3 в
 * тексте страницы; иначе начало первого абзаца; иначе номера заданий.
 */
function pageTitle(
  blocks: readonly TextbookBlockLike[],
  taskIds: readonly string[],
  taskNumber: ReadonlyMap<string, number>,
  index: number,
): string {
  for (const b of blocks) {
    if (b.type !== "rich_text" || !b.html) continue;
    const m = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(b.html);
    const text = m ? plainText(m[1]!) : "";
    if (text) return text;
  }
  for (const b of blocks) {
    if (b.type !== "rich_text" || !b.html) continue;
    const text = plainText(b.html);
    if (text) return clip(text, 60);
  }
  if (taskIds.length > 0) {
    const first = taskNumber.get(taskIds[0]!)!;
    const last = taskNumber.get(taskIds[taskIds.length - 1]!)!;
    return first === last ? `Задание ${first}` : `Задания ${first}–${last}`;
  }
  return `Страница ${index + 1}`;
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,.;:!?\s]+$/, "")}…`;
}

/** Ученик что-то ответил (хотя бы частично). Пустые поля ответом не считаются. */
export function hasAnswer(response: QuestionResponse | undefined): boolean {
  if (!response) return false;
  switch (response.type) {
    case "single_choice":
      return response.selectedOptionId !== null;
    case "multiple_choice":
      return response.selectedOptionIds.length > 0;
    case "true_false":
      return response.value !== null;
    case "text_input":
      return response.value.trim() !== "";
    case "numeric_input":
      return response.value !== null;
    case "open_answer":
      return response.text.trim() !== "" || response.attachmentIds.length > 0;
    case "cloze_dropdown":
    case "categorize":
      return Object.values(response.values).some((v) => v !== null);
    case "cloze_text":
    case "table_fill":
      return Object.values(response.values).some((v) => v.trim() !== "");
    case "matching":
      return response.pairs.length > 0;
    case "ordering":
      return response.order.length > 0;
    case "highlight_text":
      return response.selectedIds.length > 0;
  }
}

export function pointsLabel(points: number): string {
  const n = Math.abs(points) % 100;
  const d = n % 10;
  if (n >= 11 && n <= 14) return "баллов";
  if (d === 1) return "балл";
  if (d >= 2 && d <= 4) return "балла";
  return "баллов";
}
