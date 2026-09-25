import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Разбор текста из docx/pdf — чистые функции без AppError и БД. Вызываются
 * из отдельного потока (`document-extract.worker.ts`): разбор чужого файла
 * в главном потоке Node замораживал бы все идущие уроки.
 */

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_MIME = "application/pdf";

/**
 * Извлечение сырого текста (Э9.11, §7 ТЗ «импорт из Word/PDF») — только
 * ДВА формата, без легаси `.doc` (бинарный, mammoth его не читает —
 * методисту придётся пересохранить как .docx, о чём и говорит ошибка
 * ниже, а не молчаливый отказ разбирать файл).
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
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
export async function extractPdfText(buffer: Buffer): Promise<string> {
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

