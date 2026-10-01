import { execFile } from "node:child_process";
import { access, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "../../plugins/env.js";

/**
 * Обложка записи — один кадр из готового mp4 (JPEG 640px, ~30–60 КБ), лежит
 * рядом с файлом записи: `<id>.mp4` → `<id>.jpg`. Отдельной колонки нет —
 * обложка есть, если есть файл. Делается ffmpeg'ом с быстрым поиском
 * (`-ss` до `-i`): читается только ближайший ключевой кадр, а не весь файл.
 *
 * Считаем по одной за раз и с `nice`: на машине идут уроки, обложка не
 * срочная. Не вышло — запись просто остаётся с тёмной плашкой.
 */

const POSTER_WIDTH = 640;
const FFMPEG_TIMEOUT_MS = 30_000;

export function posterKeyFor(storageKey: string): string {
  return storageKey.replace(/\.mp4$/i, ".jpg");
}

function absolutePath(storageKey: string): string {
  return path.posix.join(env.STORAGE_ROOT, storageKey);
}

export async function posterExists(storageKey: string): Promise<boolean> {
  try {
    await access(absolutePath(posterKeyFor(storageKey)));
    return true;
  } catch {
    return false;
  }
}

/** Кадр примерно с трети урока: в начале обычно пустая доска и одна камера. */
function pickSecond(durationSec: number | null): number {
  if (!durationSec || durationSec < 3) return 0;
  return Math.min(Math.round(durationSec * 0.3), durationSec - 2);
}

function runFfmpeg(input: string, output: string, atSec: number): Promise<void> {
  const args = [
    "-n", "10", "ffmpeg",
    "-nostdin", "-loglevel", "error", "-y",
    "-ss", String(atSec),
    "-i", input,
    "-frames:v", "1",
    "-vf", `scale=${POSTER_WIDTH}:-2`,
    "-q:v", "5",
    "-f", "image2",
    output,
  ];
  return new Promise((resolve, reject) => {
    execFile("nice", args, { timeout: FFMPEG_TIMEOUT_MS }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`${err.message}${stderr ? `: ${stderr.trim()}` : ""}`));
      else resolve();
    });
  });
}

async function nonEmpty(file: string): Promise<boolean> {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}

async function generate(storageKey: string, durationSec: number | null): Promise<boolean> {
  const input = absolutePath(storageKey);
  const finalPath = absolutePath(posterKeyFor(storageKey));
  const tmpPath = `${finalPath}.tmp`;
  try {
    await runFfmpeg(input, tmpPath, pickSecond(durationSec));
    // Длительность из вебхука бывает неточной — поиск за конец файла даёт
    // пустой вывод без ошибки; тогда берём первый кадр.
    if (!(await nonEmpty(tmpPath))) await runFfmpeg(input, tmpPath, 0);
    if (!(await nonEmpty(tmpPath))) throw new Error("ffmpeg не выдал кадр");
    await rename(tmpPath, finalPath);
    return true;
  } catch (err) {
    await rm(tmpPath, { force: true });
    console.error("recordings: poster failed", storageKey, err instanceof Error ? err.message : err);
    return false;
  }
}

// Очередь в один поток + память о неудачах, чтобы часовой досчёт не гонял
// ffmpeg по одному и тому же битому файлу.
let queue: Promise<unknown> = Promise.resolve();
const queued = new Set<string>();
const failed = new Set<string>();

export function enqueuePoster(storageKey: string, durationSec: number | null): Promise<boolean> {
  if (queued.has(storageKey) || failed.has(storageKey)) return Promise.resolve(false);
  queued.add(storageKey);
  const job = queue.then(async () => {
    const ok = (await posterExists(storageKey)) || (await generate(storageKey, durationSec));
    if (!ok) failed.add(storageKey);
    queued.delete(storageKey);
    return ok;
  });
  queue = job.catch(() => undefined);
  return job;
}

export async function removePoster(storageKey: string): Promise<void> {
  await rm(absolutePath(posterKeyFor(storageKey)), { force: true });
}
