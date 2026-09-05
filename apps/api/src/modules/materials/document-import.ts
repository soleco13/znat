import { randomUUID } from "node:crypto";
import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { IMPORT_MAX_QUESTIONS, splitIntoQuestionChunks, type QuestionBlock } from "@school/shared";
import { AppError } from "../../plugins/errors.js";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";

/**
 * Извлечение сырого текста (Э9.11, §7 ТЗ «импорт из Word/PDF») — только
 * ДВА формата, без легаси `.doc` (бинарный, mammoth его не читает —
 * методисту придётся пересохранить как .docx, о чём и говорит ошибка
 * ниже, а не молчаливый отказ разбирать файл).
 */
async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

/**
 * `pdfjs-dist/legacy/build/pdf.mjs` — Node-совместимая сборка (без DOM),
 * та же библиотека, что уже одобрена и используется в apps/web (Э4.7,
 * просмотр PDF-презентаций в браузере), здесь — новое применение на
 * сервере, не новая зависимость по существу. Без `GlobalWorkerOptions.workerSrc`
 * — библиотека сама переключается в синхронный «fake worker» режим при
 * отсутствии `Worker` (в Node его нет), это и есть назначение `legacy`-сборки.
 *
 * pdf.js не даёт готовых переводов строк в `getTextContent()` — только
 * плоский список текстовых фрагментов с матрицей трансформации у каждого
 * (`item.transform[5]` — Y-координата на странице). Разрыв строки
 * реконструируется по смене Y между соседними фрагментами (эвристика, не
 * точный алгоритм вёрстки) — этого достаточно, чтобы нумерованные строки
 * вопросов (`splitIntoQuestionChunks`, `packages/shared`) остались
 * различимыми по позиции в тексте, не смешавшись в одну строку.
 */
async function extractPdfText(buffer: Buffer): Promise<string> {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  try {
    const lines: string[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      let lastY: number | null = null;
      let lineBuf = "";
      for (const item of content.items) {
        if (!("str" in item)) continue; // TextMarkedContent — не текст, пропускаем
        const y = item.transform[5] as number;
        if (lastY !== null && Math.abs(y - lastY) > 1) {
          lines.push(lineBuf);
          lineBuf = "";
        }
        lineBuf += item.str;
        lastY = y;
      }
      if (lineBuf) lines.push(lineBuf);
      lines.push(""); // разделитель страниц — граница вопроса не должна потеряться на стыке
    }
    return lines.join("\n");
  } finally {
    await doc.destroy();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Текст из документа — НЕДОВЕРЕННЫЙ ввод (Э9.11): превращается в
 * `prompt.html`, который на фронте рендерится через `dangerouslySetInnerHTML`
 * (пусть и за `sanitizeHtml`, `apps/web/src/shared/sanitize-html.ts` —
 * второй рубеж, не единственный). Экранирование здесь — ПЕРВЫЙ рубеж:
 * без него `<`/`>`/`&`, которые реально попадаются в тексте вопросов
 * (математические неравенства, «Тест & проверка»), сломали бы разметку
 * или, в худшем случае, представляли риск инъекции, если бы
 * `sanitizeHtml` пропустил что-то по недосмотру.
 */
function chunkToHtml(chunk: string): string {
  return chunk
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

/** Стаб `open_answer` — та же форма, что `createInteraction("open_answer")` во фронтовом `block-factories.ts` (Э9.10), продублирована здесь НАМЕРЕННО: apps/api не имеет права импортировать код apps/web (отдельные приложения, не модули одного слоя), а выносить в packages/shared ради одной функции, используемой ровно в двух местах по разным причинам (клиентская кнопка «Добавить блок» vs серверный импорт), избыточно. */
function buildOpenAnswerBlock(promptHtml: string): QuestionBlock {
  return {
    type: "question",
    id: randomUUID(),
    prompt: { html: promptHtml },
    points: 1,
    interaction: {
      type: "open_answer",
      maxLength: 2000,
      allowAttachments: false,
      rubric: [{ id: randomUUID(), label: "", points: 1 }],
    },
  };
}

/**
 * Полуавтоматический импорт (Э9.11, §7 ТЗ). Каждый распознанный кусок
 * текста становится ОДНИМ `open_answer`-блоком (минимальная эвристика —
 * осознанный выбор, см. докстринг `splitIntoQuestionChunks`) — методист
 * дальше сам меняет тип/добавляет варианты в уже готовом редакторе
 * (Э9.2–9.6). Ничего не пишет в БД и не трогает конкретный материал —
 * чистое преобразование «файл → блоки», добавление блоков в открытый
 * черновик решает вызывающая сторона (клиент).
 */
export async function importQuestionsFromDocument(
  buffer: Buffer,
  mimeType: string,
): Promise<{ blocks: QuestionBlock[]; truncated: boolean }> {
  let text: string;
  if (mimeType === DOCX_MIME) {
    text = await extractDocxText(buffer);
  } else if (mimeType === PDF_MIME) {
    text = await extractPdfText(buffer);
  } else {
    throw new AppError(
      400,
      "unsupported_type",
      "Поддерживаются файлы .docx и .pdf (старый формат .doc — пересохраните как .docx)",
    );
  }

  const chunks = splitIntoQuestionChunks(text);
  const capped = chunks.slice(0, IMPORT_MAX_QUESTIONS);
  return {
    blocks: capped.map((chunk) => buildOpenAnswerBlock(chunkToHtml(chunk))),
    truncated: chunks.length > capped.length,
  };
}
