/**
 * Пайплайн конвертации презентации (Э4.3, §3.5 ТЗ):
 *   ClamAV-скан → [LibreOffice → PDF] → pdfinfo → pdftoppm (PNG@2x + JPEG-превью)
 *   → StorageAdapter, с прогрессом «N из total».
 *
 * Всё промежуточное — в изолированном каталоге под /tmp (tmpfs, единственная
 * writable точка read_only-контейнера). Внешние бинарники вызываются через
 * execFile с массивом аргументов (без shell) и таймаутами.
 *
 * Превью — JPEG через тот же pdftoppm (не sharp/cwebp): не тянем в
 * air-gapped-контейнер лишнюю зависимость, для миниатюры формат некритичен
 * («PNG@2x надёжнее для MVP» — §3.5 ТЗ, тот же принцип).
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ConvertJobData, ConvertJobResult, ConvertedSlide } from "./contract.js";
import * as storage from "./storage.js";

const execFileAsync = promisify(execFile);

const SOFFICE_TIMEOUT_MS = 120_000;
const PDFTOPPM_TIMEOUT_MS = 30_000;
const CLAMSCAN_TIMEOUT_MS = 120_000;

/** DPI рендера. 144 = 2× относительно базовых 72 dpi PDF («PNG@2x», §3.5 ТЗ). */
const RENDER_DPI = 144;
const THUMB_DPI = 32;
/** Защита от «презентации-бомбы» — разумный потолок числа слайдов. */
const MAX_SLIDES = 500;

export type ProgressFn = (p: { done: number; total: number }) => void | Promise<void>;

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>): void {
  const line = { ts: new Date().toISOString(), level, svc: "converter", msg, ...extra };
  (level === "error" ? process.stderr : process.stdout).write(`${JSON.stringify(line)}\n`);
}

/** Ширина/высота PNG из IHDR (байты 16..23, big-endian) — без графических библиотек. */
function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("Не PNG: не удалось прочитать размеры слайда");
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function clamScan(filePath: string): Promise<void> {
  try {
    await execFileAsync("clamscan", ["--no-summary", "--stdout", filePath], {
      timeout: CLAMSCAN_TIMEOUT_MS,
    });
    log("info", "clamscan clean", { filePath });
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string };
    // clamscan: код 1 = найден вирус, код 2 = ошибка сканирования.
    if (e.code === 1) {
      throw new Error(`Файл не прошёл антивирусную проверку: ${(e.stdout ?? "").trim()}`);
    }
    if (e.code === "ENOENT") {
      throw new Error("clamscan не найден в образе конвертера");
    }
    throw new Error(`Ошибка антивирусной проверки (код ${String(e.code)})`);
  }
}

/** .pptx/.docx/.odp → PDF. Возвращает путь к PDF во временном каталоге. */
async function officeToPdf(sourcePath: string, workDir: string): Promise<string> {
  const profileDir = path.join(workDir, "lo-profile");
  await execFileAsync(
    "soffice",
    [
      "--headless",
      "--nologo",
      "--nofirststartwizard",
      `-env:UserInstallation=file://${profileDir}`,
      "--convert-to",
      "pdf",
      "--outdir",
      workDir,
      sourcePath,
    ],
    { timeout: SOFFICE_TIMEOUT_MS },
  );
  const produced = (await readdir(workDir)).find((f) => f.toLowerCase().endsWith(".pdf"));
  if (!produced) {
    throw new Error("LibreOffice не создал PDF (возможно, битый или неподдерживаемый файл)");
  }
  return path.join(workDir, produced);
}

async function pdfPageCount(pdfPath: string): Promise<number> {
  const { stdout } = await execFileAsync("pdfinfo", [pdfPath], { timeout: 15_000 });
  const m = stdout.match(/^Pages:\s+(\d+)/m);
  if (!m) throw new Error("pdfinfo не вернул число страниц");
  return Number(m[1]);
}

/** Рендерит одну страницу PDF в PNG (или JPEG для превью). Возвращает путь к файлу. */
async function renderPage(
  pdfPath: string,
  page: number,
  dpi: number,
  format: "png" | "jpeg",
  outPrefix: string,
): Promise<string> {
  await execFileAsync(
    "pdftoppm",
    [
      `-${format}`,
      "-r",
      String(dpi),
      "-f",
      String(page),
      "-l",
      String(page),
      "-cropbox",
      pdfPath,
      outPrefix,
    ],
    { timeout: PDFTOPPM_TIMEOUT_MS },
  );
  const dir = path.dirname(outPrefix);
  const base = path.basename(outPrefix);
  const produced = (await readdir(dir)).find(
    (f) => f.startsWith(base) && (f.endsWith(`.${format}`) || f.endsWith(".jpg")),
  );
  if (!produced) throw new Error(`pdftoppm не отрендерил страницу ${page}`);
  return path.join(dir, produced);
}

export async function runConversion(
  data: ConvertJobData,
  onProgress: ProgressFn,
): Promise<ConvertJobResult> {
  const src = storage.sourcePath(data.sourceStorageKey);
  const workDir = await mkdtemp(path.join(tmpdir(), "deck-"));
  log("info", "conversion start", { deckId: data.deckId, workDir });

  try {
    await clamScan(src);

    const pdfPath =
      data.sourceMimeType === "application/pdf" ? src : await officeToPdf(src, workDir);

    const total = await pdfPageCount(pdfPath);
    if (total < 1) throw new Error("В документе нет страниц");
    if (total > MAX_SLIDES) {
      throw new Error(`Слишком много слайдов: ${total} (максимум ${MAX_SLIDES})`);
    }

    const slides: ConvertedSlide[] = [];
    for (let page = 1; page <= total; page++) {
      const fullPath = await renderPage(
        pdfPath,
        page,
        RENDER_DPI,
        "png",
        path.join(workDir, `full-${page}`),
      );
      const thumbPath = await renderPage(
        pdfPath,
        page,
        THUMB_DPI,
        "jpeg",
        path.join(workDir, `thumb-${page}`),
      );

      const { width, height } = pngSize(await readFile(fullPath));
      const image = await storage.putPath({ schoolId: data.schoolId, ext: ".png", filePath: fullPath });
      const thumb = await storage.putPath({ schoolId: data.schoolId, ext: ".jpg", filePath: thumbPath });

      slides.push({
        index: page - 1,
        imageStorageKey: image.storageKey,
        thumbStorageKey: thumb.storageKey,
        width,
        height,
        textLayer: null, // Э4.8
      });

      await rm(fullPath, { force: true });
      await rm(thumbPath, { force: true });
      await onProgress({ done: page, total });
    }

    log("info", "conversion done", { deckId: data.deckId, slideCount: slides.length });
    return { slideCount: slides.length, slides };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
