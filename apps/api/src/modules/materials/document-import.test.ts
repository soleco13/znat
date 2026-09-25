import { describe, expect, it } from "vitest";
import { docxUnpackedSize, importQuestionsFromDocument } from "./document-import.js";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";

/**
 * Реальный минимальный .docx (не мок mammoth) — тот же приём, что уже
 * применялся в проекте для декодирования реальных артефактов вместо
 * мокания SDK (`canvas/images.test.ts`, Э3.10; `media-library.test.ts`,
 * Э9.7): собран один раз через `jszip` (транзитивная зависимость
 * mammoth) во временном скрипте этой сессии, скрипт не остался в
 * репозитории — здесь только готовые байты. Содержимое `word/document.xml`
 * (для сверки, не часть теста):
 *   Инструкция для ученика.
 *   1. Столица Франции?
 *   а) Париж
 *   б) Лондон
 *   2. Сколько будет 2+2?
 *   а) 3
 *   б) 4
 *   3. Реши неравенство x < 3 & y > 1
 * Третий пункт — СПЕЦИАЛЬНО с `<`/`&`/`>` (в XML документа они уже
 * XML-экранированы как `&lt;`/`&amp;`/`&gt;`, mammoth при разборе отдаёт
 * их РАСКОДИРОВАННЫМИ — литеральными символами; проверяет, что
 * `chunkToHtml` заново экранирует их для HTML, не пропускает как разметку).
 */
const MINIMAL_DOCX_BASE64 =
  "UEsDBAoAAAAAAE+wJF0XmADXsgEAALIBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz4KPFR5cGVzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L2NvbnRlbnQtdHlwZXMiPgo8RGVmYXVsdCBFeHRlbnNpb249InJlbHMiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtcGFja2FnZS5yZWxhdGlvbnNoaXBzK3htbCIvPgo8RGVmYXVsdCBFeHRlbnNpb249InhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3htbCIvPgo8T3ZlcnJpZGUgUGFydE5hbWU9Ii93b3JkL2RvY3VtZW50LnhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC53b3JkcHJvY2Vzc2luZ21sLmRvY3VtZW50Lm1haW4reG1sIi8+CjwvVHlwZXM+UEsDBAoAAAAAAE+wJF0AAAAAAAAAAAAAAAAGAAAAX3JlbHMvUEsDBAoAAAAAAE+wJF0/rf76LAEAACwBAAALAAAAX3JlbHMvLnJlbHM8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+CjxSZWxhdGlvbnNoaXBzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L3JlbGF0aW9uc2hpcHMiPgo8UmVsYXRpb25zaGlwIElkPSJySWQxIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL29mZmljZURvY3VtZW50IiBUYXJnZXQ9IndvcmQvZG9jdW1lbnQueG1sIi8+CjwvUmVsYXRpb25zaGlwcz5QSwMECgAAAAAAT7AkXQAAAAAAAAAAAAAAAAUAAAB3b3JkL1BLAwQKAAAAAABPsCRdqIIx9zMDAAAzAwAAEQAAAHdvcmQvZG9jdW1lbnQueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pgo8dzpkb2N1bWVudCB4bWxuczp3PSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvd29yZHByb2Nlc3NpbmdtbC8yMDA2L21haW4iPgo8dzpib2R5Pgo8dzpwPjx3OnI+PHc6dCB4bWw6c3BhY2U9InByZXNlcnZlIj7QmNC90YHRgtGA0YPQutGG0LjRjyDQtNC70Y8g0YPRh9C10L3QuNC60LAuPC93OnQ+PC93OnI+PC93OnA+Cjx3OnA+PHc6cj48dzp0IHhtbDpzcGFjZT0icHJlc2VydmUiPjEuINCh0YLQvtC70LjRhtCwINCk0YDQsNC90YbQuNC4Pzwvdzp0PjwvdzpyPjwvdzpwPgo8dzpwPjx3OnI+PHc6dCB4bWw6c3BhY2U9InByZXNlcnZlIj7QsCkg0J/QsNGA0LjQtjwvdzp0PjwvdzpyPjwvdzpwPgo8dzpwPjx3OnI+PHc6dCB4bWw6c3BhY2U9InByZXNlcnZlIj7QsSkg0JvQvtC90LTQvtC9PC93OnQ+PC93OnI+PC93OnA+Cjx3OnA+PHc6cj48dzp0IHhtbDpzcGFjZT0icHJlc2VydmUiPjIuINCh0LrQvtC70YzQutC+INCx0YPQtNC10YIgMisyPzwvdzp0PjwvdzpyPjwvdzpwPgo8dzpwPjx3OnI+PHc6dCB4bWw6c3BhY2U9InByZXNlcnZlIj7QsCkgMzwvdzp0PjwvdzpyPjwvdzpwPgo8dzpwPjx3OnI+PHc6dCB4bWw6c3BhY2U9InByZXNlcnZlIj7QsSkgNDwvdzp0PjwvdzpyPjwvdzpwPgo8dzpwPjx3OnI+PHc6dCB4bWw6c3BhY2U9InByZXNlcnZlIj4zLiDQoNC10YjQuCDQvdC10YDQsNCy0LXQvdGB0YLQstC+IHggJmx0OyAzICZhbXA7IHkgJmd0OyAxPC93OnQ+PC93OnI+PC93OnA+Cjwvdzpib2R5Pgo8L3c6ZG9jdW1lbnQ+UEsBAhQACgAAAAAAT7AkXReYANeyAQAAsgEAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAKAAAAAABPsCRdAAAAAAAAAAAAAAAABgAAAAAAAAAAABAAAADjAQAAX3JlbHMvUEsBAhQACgAAAAAAT7AkXT+t/vosAQAALAEAAAsAAAAAAAAAAAAAAAAABwIAAF9yZWxzLy5yZWxzUEsBAhQACgAAAAAAT7AkXQAAAAAAAAAAAAAAAAUAAAAAAAAAAAAQAAAAXAMAAHdvcmQvUEsBAhQACgAAAAAAT7AkXaiCMfczAwAAMwMAABEAAAAAAAAAAAAAAAAAfwMAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAAFAAUAIAEAAOEGAAAAAA==";

/**
 * Минимальный валидный PDF, собранный вручную (текстовый control-stream,
 * без внешних библиотек) — офсеты xref посчитаны в коде, не подогнаны
 * руками. Латиница вместо кириллицы — стандартный Helvetica/WinAnsi без
 * встроенного ToUnicode CMap не гарантирует кириллицу, а тест проверяет
 * ГРАНИЦЫ распознавания вопросов и склейку строк pdf.js, не конкретный
 * алфавит.
 *
 * Нижняя граница `MediaBox` растёт (в отрицательную сторону) вместе с
 * числом строк, не фиксированные [0 0 612 792] «лист A4» — НАЙДЕНО
 * эмпирически при отладке этого файла: pdf.js реально НЕ отдаёт из
 * `getTextContent()` текст, чей `Td` увёл его за пределы `MediaBox`
 * страницы (сама PDF-страница КОНЕЧНА, а этот тест кладёт весь текст в
 * одну колонку, уходящую вниз от y=700, вместо честной постраничной
 * разбивки, которую делает Word/LibreOffice в реальном экспорте).
 * Фиксированной высоты хватало на тесты с малым числом строк, но тест
 * «документ-бомба» (250 строк, y уходит в −4300) без этой поправки терял
 * всё после 36-й строки — не баг `extractPdfText`, баг тестового
 * генератора PDF (первая попытка чинить его же — расширить ВЕРХНЮЮ
 * границу — не сработала: текст не поднимается выше 700, ему не хватало
 * именно нижней).
 */
function buildMinimalPdf(lines: string[]): Buffer {
  const streamContent =
    "BT /F1 12 Tf 10 700 Td " +
    lines.map((l) => `(${l.replace(/[()\\]/g, (c) => "\\" + c)}) Tj 0 -20 Td`).join(" ") +
    " ET";
  // Текст стартует на y=700 и уходит ВНИЗ (Td -20 на строку) — расширяем
  // нижнюю границу MediaBox в отрицательную сторону (не верхнюю: текст
  // никогда не поднимается выше 700, растущий бесполезно верхний предел
  // ничего бы не исправил — именно так и не сработала первая попытка).
  const yMin = Math.min(0, 700 - lines.length * 20 - 20);

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 ${yMin} 612 792] /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}

function htmlOf(block: { prompt: { html: string } }): string {
  return block.prompt.html;
}

describe("importQuestionsFromDocument (Э9.11, §7 ТЗ: полуавтоматический импорт из Word/PDF)", () => {
  it("отклоняет неподдерживаемый MIME-тип (в т.ч. легаси .doc) до попытки распарсить содержимое", async () => {
    await expect(importQuestionsFromDocument(Buffer.from("whatever"), "application/msword")).rejects.toMatchObject({
      statusCode: 400,
      code: "unsupported_type",
    });
  });

  it(".docx: разбирает РЕАЛЬНЫЙ документ (mammoth, не мок) на преамбулу + 3 пронумерованных вопроса", async () => {
    const buffer = Buffer.from(MINIMAL_DOCX_BASE64, "base64");
    const result = await importQuestionsFromDocument(buffer, DOCX_MIME);

    expect(result.truncated).toBe(false);
    expect(result.blocks).toHaveLength(4);
    expect(result.blocks.every((b) => b.type === "question" && b.interaction.type === "open_answer")).toBe(true);
    expect(htmlOf(result.blocks[0]!)).toBe("<p>Инструкция для ученика.</p>");
    expect(htmlOf(result.blocks[1]!)).toBe("<p>1. Столица Франции?</p><p>а) Париж</p><p>б) Лондон</p>");
    expect(htmlOf(result.blocks[2]!)).toBe("<p>2. Сколько будет 2+2?</p><p>а) 3</p><p>б) 4</p>");
  });

  it(".docx: HTML-экранирует спецсимволы, раскодированные mammoth из XML (`<`/`&`/`>`, реально встречаются в тексте задач — «x < 3 & y > 1») — не пропускает их как разметку", async () => {
    const buffer = Buffer.from(MINIMAL_DOCX_BASE64, "base64");
    const result = await importQuestionsFromDocument(buffer, DOCX_MIME);
    expect(htmlOf(result.blocks[3]!)).toBe("<p>3. Реши неравенство x &lt; 3 &amp; y &gt; 1</p>");
  });

  it(".docx: каждый блок — валидный по форме open_answer (id/rubric на месте, как и у ручного «Добавить блок»)", async () => {
    const buffer = Buffer.from(MINIMAL_DOCX_BASE64, "base64");
    const result = await importQuestionsFromDocument(buffer, DOCX_MIME);
    for (const block of result.blocks) {
      expect(block.id).toMatch(/^[0-9a-f-]{36}$/);
      if (block.interaction.type === "open_answer") {
        expect(block.interaction.rubric.length).toBeGreaterThan(0);
        expect(block.interaction.rubric[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
      }
      expect(block.points).toBeGreaterThan(0);
    }
  });

  it(".pdf: разбирает РЕАЛЬНЫЙ PDF (pdfjs-dist, не мок) — те же 2 вопроса, границы по номерам сохранены", async () => {
    const pdf = buildMinimalPdf([
      "1. Stolica Francii?",
      "a) Parizh",
      "b) London",
      "2. Skolko budet 2+2?",
      "a) 3",
      "b) 4",
    ]);
    const result = await importQuestionsFromDocument(pdf, PDF_MIME);

    expect(result.truncated).toBe(false);
    expect(result.blocks).toHaveLength(2);
    expect(htmlOf(result.blocks[0]!)).toBe("<p>1. Stolica Francii?</p><p>a) Parizh</p><p>b) London</p>");
    expect(htmlOf(result.blocks[1]!)).toBe("<p>2. Skolko budet 2+2?</p><p>a) 3</p><p>b) 4</p>");
  });

  it(".pdf: документ без единой нумерованной строки — один блок на весь текст (деградация, не пустой результат)", async () => {
    const pdf = buildMinimalPdf(["Prosto tekst", "bez spiska voprosov"]);
    const result = await importQuestionsFromDocument(pdf, PDF_MIME);
    expect(result.blocks).toHaveLength(1);
    expect(htmlOf(result.blocks[0]!)).toBe("<p>Prosto tekst</p><p>bez spiska voprosov</p>");
  });

  it("режет результат на IMPORT_MAX_QUESTIONS и сообщает truncated=true — не роняет запрос на документе-бомбе", async () => {
    const lines = Array.from({ length: 250 }, (_, i) => `${i + 1}. Question ${i + 1}`);
    const pdf = buildMinimalPdf(lines);
    const result = await importQuestionsFromDocument(pdf, PDF_MIME);
    expect(result.blocks).toHaveLength(200);
    expect(result.truncated).toBe(true);
  });
});

describe("docxUnpackedSize (защита от zip-бомбы до распаковки)", () => {
  it("суммирует распакованные размеры файлов из центрального каталога", () => {
    const size = docxUnpackedSize(Buffer.from(MINIMAL_DOCX_BASE64, "base64"));
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(10_000);
  });

  it("не zip — null (документ отклоняется)", () => {
    expect(docxUnpackedSize(Buffer.from("not a zip at all"))).toBeNull();
  });

  it("распакованный размер больше лимита — импорт отклоняется без разбора", async () => {
    const docx = Buffer.from(MINIMAL_DOCX_BASE64, "base64");
    // Подменяем распакованный размер первого файла в центральном каталоге на 200 МБ.
    const cd = docx.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    docx.writeUInt32LE(200 * 1024 * 1024, cd + 24);
    await expect(importQuestionsFromDocument(docx, DOCX_MIME)).rejects.toMatchObject({
      statusCode: 422,
      code: "document_too_complex",
    });
  });
});
