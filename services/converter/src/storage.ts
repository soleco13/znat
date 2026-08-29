/**
 * Мини-адаптер хранилища для конвертера. СОЗНАТЕЛЬНО отдельный от
 * `apps/api/src/modules/storage` — конвертер не импортирует код приложения
 * (граница модулей + отдельная сборка/контейнер). Правило CLAUDE.md «доступ к
 * файлам только через StorageAdapter, ни одного fs.readFile в бизнес-логике»
 * соблюдено: `convert.ts` ходит в файлы только через эти функции.
 *
 * Реализация — LocalFS (тот же `/data/assets`, что монтируется томом и в `app`).
 * S3 конвертеру не нужен: он всегда рядом с диском.
 */
import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const ROOT = process.env.STORAGE_ROOT ?? "/data/assets";

function resolveKey(storageKey: string): string {
  const resolved = path.resolve(ROOT, storageKey);
  if (resolved !== path.resolve(ROOT) && !resolved.startsWith(path.resolve(ROOT) + path.sep)) {
    throw new Error(`Invalid storage key: path escapes storage root (${storageKey})`);
  }
  return resolved;
}

/** Абсолютный путь исходника — для передачи внешним бинарникам (soffice/pdftoppm). */
export function sourcePath(storageKey: string): string {
  return resolveKey(storageKey);
}

export function openRead(storageKey: string): NodeJS.ReadableStream {
  return createReadStream(resolveKey(storageKey));
}

/** Кладёт готовый файл (слайд/превью) под новым ключом в каталоге школы. */
export async function putFile(input: {
  schoolId: string;
  ext: string;
  data: Buffer;
}): Promise<{ storageKey: string; sizeBytes: number }> {
  const storageKey = path.posix.join(input.schoolId, `${randomUUID()}${input.ext}`);
  const dest = resolveKey(storageKey);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, input.data);
  return { storageKey, sizeBytes: input.data.byteLength };
}

/** Копирует уже существующий на диске файл (из /tmp) под ключ хранилища. */
export async function putPath(input: {
  schoolId: string;
  ext: string;
  filePath: string;
}): Promise<{ storageKey: string; sizeBytes: number }> {
  const { readFile } = await import("node:fs/promises");
  const data = await readFile(input.filePath);
  return putFile({ schoolId: input.schoolId, ext: input.ext, data });
}

export async function removeKey(storageKey: string): Promise<void> {
  await rm(resolveKey(storageKey), { force: true });
}
