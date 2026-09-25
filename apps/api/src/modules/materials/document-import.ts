import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { IMPORT_MAX_QUESTIONS, splitIntoQuestionChunks, type QuestionBlock } from "@school/shared";
import { AppError } from "../../plugins/errors.js";

import { DOCX_MIME, PDF_MIME, extractDocxText, extractPdfText } from "./document-extract.js";

/** Разбор дольше этого — документ-ловушка или слишком сложный; поток убивается. */
const EXTRACT_TIMEOUT_MS = 20_000;
/** Потолок кучи потока разбора — утечка памяти в нём не роняет сервер уроков. */
const EXTRACT_MAX_HEAP_MB = 256;
/** Одновременных разборов на процесс — больше ждать не заставляем, отвечаем «занято». */
const MAX_PARALLEL_EXTRACTS = 2;
/** Сумма распакованных размеров файлов внутри docx. Реальный документ с вопросами — единицы МБ. */
const DOCX_MAX_UNPACKED_BYTES = 100 * 1024 * 1024;

let activeExtracts = 0;

/**
 * Защита от zip-бомбы до распаковки: docx — это zip, и 20 МБ сжатых данных
 * разворачиваются в гигабайты. Центральный каталог zip хранит распакованный
 * размер каждого файла — суммируем его, не распаковывая ничего. Zip64 (поля
 * 0xFFFFFFFF) в docx с вопросами не встречается — такой файл отклоняем.
 */
export function docxUnpackedSize(buffer: Buffer): number | null {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  const minEocd = 22;
  for (let i = buffer.length - minEocd; i >= Math.max(0, buffer.length - minEocd - 0xffff); i--) {
    if (buffer.readUInt32LE(i) !== EOCD_SIG) continue;
    const entries = buffer.readUInt16LE(i + 10);
    let offset = buffer.readUInt32LE(i + 16);
    let total = 0;
    for (let n = 0; n < entries; n++) {
      if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CD_SIG) return null;
      const unpacked = buffer.readUInt32LE(offset + 24);
      if (unpacked === 0xffffffff) return null;
      total += unpacked;
      offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    }
    return total;
  }
  return null;
}

function tooComplex(): AppError {
  return new AppError(422, "document_too_complex", "Не удалось разобрать документ — он слишком большой или повреждён");
}

/**
 * Текст документа из отдельного потока с лимитом памяти и времени. В
 * исходниках (.ts — dev через tsx и тесты) поток не поднимается: там нет
 * собранного .js воркера, и разбор идёт прямо здесь.
 */
async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  if (!import.meta.url.endsWith(".js")) {
    return mimeType === DOCX_MIME ? extractDocxText(buffer) : extractPdfText(buffer);
  }
  if (activeExtracts >= MAX_PARALLEL_EXTRACTS) {
    throw new AppError(429, "import_busy", "Сейчас разбирается другой документ — попробуйте через минуту");
  }
  activeExtracts++;
  const worker = new Worker(new URL("./document-extract.worker.js", import.meta.url), {
    workerData: { buffer, mimeType },
    resourceLimits: { maxOldGenerationSizeMb: EXTRACT_MAX_HEAP_MB },
  });
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(tooComplex()), EXTRACT_TIMEOUT_MS);
      worker.once("message", (msg: { ok: true; text: string } | { ok: false; message: string }) => {
        clearTimeout(timer);
        if (msg.ok) resolve(msg.text);
        else reject(tooComplex());
      });
      worker.once("error", () => {
        clearTimeout(timer);
        reject(tooComplex());
      });
      worker.once("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(tooComplex());
      });
    });
  } finally {
    activeExtracts--;
    void worker.terminate();
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
  if (mimeType === DOCX_MIME) {
    const unpacked = docxUnpackedSize(buffer);
    if (unpacked === null || unpacked > DOCX_MAX_UNPACKED_BYTES) throw tooComplex();
  } else if (mimeType !== PDF_MIME) {
    throw new AppError(
      400,
      "unsupported_type",
      "Поддерживаются файлы .docx и .pdf (старый формат .doc — пересохраните как .docx)",
    );
  }

  const text = await extractText(buffer, mimeType);
  const chunks = splitIntoQuestionChunks(text);
  const capped = chunks.slice(0, IMPORT_MAX_QUESTIONS);
  return {
    blocks: capped.map((chunk) => buildOpenAnswerBlock(chunkToHtml(chunk))),
    truncated: chunks.length > capped.length,
  };
}
