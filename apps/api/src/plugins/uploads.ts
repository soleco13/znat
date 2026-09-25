import { Transform, pipeline } from "node:stream";
import type { FastifyRequest } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import { AppError } from "./errors.js";

const MB = 1024 * 1024;

/**
 * Потолки загрузок по маршрутам. Глобальный лимит multipart (server.ts) равен
 * самому маленькому из них — маршрут, который забыл передать свой, не примет
 * больше картинки на доску.
 */
export const UPLOAD_LIMITS = {
  /** Картинка на доску — грузит любой участник с правом рисовать. */
  canvasImage: 10 * MB,
  /** Картинка или аудио в медиатеку материалов. */
  mediaAsset: 25 * MB,
  /** Word/PDF для импорта вопросов — разбирается целиком в памяти. */
  documentImport: 20 * MB,
  /** Презентация урока (§8.1 ТЗ: до 100 МБ) — пишется на диск потоком. */
  deck: 100 * MB,
  /** Общий `/assets` — потоком на диск. */
  generic: 100 * MB,
} as const;

/** Запас на заголовки multipart поверх самого файла при сверке Content-Length. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Сколько байт загрузок процесс одновременно держит в памяти (файл + его
 * обработка). Всё сверх — 503 с Retry-After, а не OOM единственного процесса,
 * на котором идут все уроки. Счётчик теряется при рестарте вместе с самими
 * загрузками — это не состояние, а семафор.
 */
const IN_MEMORY_BUDGET_BYTES = 96 * MB;
let inMemoryBytes = 0;

function tooLarge(maxBytes: number): AppError {
  return new AppError(413, "file_too_large", `Файл больше ${Math.round(maxBytes / MB)} МБ`);
}

/** Отказ до чтения тела, если клиент честно заявил размер больше лимита. */
function assertDeclaredSize(request: FastifyRequest, maxBytes: number): number | null {
  const header = request.headers["content-length"];
  const declared = header ? Number(header) : NaN;
  if (!Number.isFinite(declared)) return null;
  if (declared > maxBytes + MULTIPART_OVERHEAD_BYTES) throw tooLarge(maxBytes);
  return declared;
}

async function requireFile(request: FastifyRequest, maxBytes: number): Promise<MultipartFile> {
  const file = await request.file({ limits: { fileSize: maxBytes, files: 1 } });
  if (!file) throw new AppError(400, "no_file", "Файл не передан");
  return file;
}

/**
 * Файл целиком в память — для того, что без буфера не обработать (sharp,
 * mammoth, pdf). Место в общем бюджете занимается до чтения тела и
 * освобождается после `handle`, то есть покрывает и саму обработку.
 */
export async function withBufferedUpload<T>(
  request: FastifyRequest,
  maxBytes: number,
  handle: (file: { buffer: Buffer; mimetype: string; filename: string }) => Promise<T>,
): Promise<T> {
  const declared = assertDeclaredSize(request, maxBytes);
  const reserved = Math.min(declared ?? maxBytes, maxBytes + MULTIPART_OVERHEAD_BYTES);
  if (inMemoryBytes + reserved > IN_MEMORY_BUDGET_BYTES) {
    throw new AppError(503, "uploads_busy", "Сервер обрабатывает другие файлы — повторите через несколько секунд");
  }
  inMemoryBytes += reserved;
  try {
    const file = await requireFile(request, maxBytes);
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (err) {
      if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw tooLarge(maxBytes);
      throw err;
    }
    return await handle({ buffer, mimetype: file.mimetype, filename: file.filename });
  } finally {
    inMemoryBytes -= reserved;
  }
}

/**
 * Файл потоком, без буфера. Превышение лимита рвёт поток ошибкой 413 —
 * потребитель (`storageService.uploadFile`) видит её в `pipeline` и не
 * сохраняет обрезанный файл.
 */
export async function openStreamedUpload(
  request: FastifyRequest,
  maxBytes: number,
): Promise<{ stream: NodeJS.ReadableStream; mimetype: string; filename: string }> {
  assertDeclaredSize(request, maxBytes);
  const file = await requireFile(request, maxBytes);
  // busboy на лимите не падает, а молча обрезает файл и завершает поток —
  // превращаем обрезку в ошибку в конце потока.
  const guarded = new Transform({
    transform(chunk, _encoding, callback) {
      callback(null, chunk);
    },
    flush(callback) {
      callback(file.file.truncated ? tooLarge(maxBytes) : null);
    },
  });
  pipeline(file.file, guarded, () => {});
  return { stream: guarded, mimetype: file.mimetype, filename: file.filename };
}

export function uploadsInMemoryBytes(): number {
  return inMemoryBytes;
}
