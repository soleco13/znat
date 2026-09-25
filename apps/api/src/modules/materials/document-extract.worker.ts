import { parentPort, workerData } from "node:worker_threads";
import { DOCX_MIME, extractDocxText, extractPdfText } from "./document-extract.js";

/** Поток разбора одного документа: получает байты и MIME, возвращает текст или сообщение об ошибке. */
const { buffer, mimeType } = workerData as { buffer: Uint8Array; mimeType: string };
const data = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);

(mimeType === DOCX_MIME ? extractDocxText(data) : extractPdfText(data)).then(
  (text) => parentPort!.postMessage({ ok: true, text }),
  (err: unknown) => parentPort!.postMessage({ ok: false, message: err instanceof Error ? err.message : String(err) }),
);
