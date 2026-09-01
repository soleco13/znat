/**
 * Пайплайн конвертации презентации (Э4.3, §3.5 ТЗ):
 *   ClamAV-скан → [LibreOffice → PDF] → pdfinfo → pdftoppm (PNG@2x + JPEG-превью)
 *   → StorageAdapter, с прогрессом «N из total».
 *
 * Э4.7: если исходник уже PDF — растеризация пропускается целиком. Воркер
 * только сканирует файл ClamAV и считает страницы (pdfinfo); сам PDF
 * рендерит pdf.js в браузере из подписанного URL исходника. Экономит CPU
 * LibreOffice/Poppler во время уроков — прямой предмет гейта Э4.
 *
 * Э4.8: для растрового пайплайна (не PDF-passthrough) параллельно с рендером
 * PNG строится текстовый слой — один вызов `pdftotext -bbox` на весь
 * промежуточный PDF, результат режется по страницам. Слайды остаются
 * картинками (PNG, не выделяемый/копируемый текст на холсте — сознательно,
 * стоп-лист Э4 про PowerPoint-переходы тут ни при чём, просто у нас нет
 * text-layer поверх canvas), но текст слоя уходит в БД и используется
 * фронтом для полнотекстового поиска по презентации. Для PDF-passthrough
 * своего текстового слоя нет — pdf.js и так парсит текст PDF в браузере,
 * второй раз на сервере это делать незачем.
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
import type { ConvertJobData, ConvertJobResult, ConvertedSlide, SlideTextBox } from "./contract.js";
import * as storage from "./storage.js";

const execFileAsync = promisify(execFile);

const SOFFICE_TIMEOUT_MS = 120_000;
const PDFTOPPM_TIMEOUT_MS = 30_000;
const CLAMSCAN_TIMEOUT_MS = 120_000;
const PDFTOTEXT_TIMEOUT_MS = 20_000;

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

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Текстовый слой всех страниц одним вызовом `pdftotext -bbox` (Э4.8, §3.5
 * ТЗ: «поиск по презентации»). Один процесс на весь документ, а не по одному
 * на страницу, — дешевле по CPU (гейт Э4 следит за нагрузкой конвертера).
 * `x/y/w/h` — ДОЛИ ширины/высоты страницы (0..1), не пиксели: не зависят от
 * DPI рендера PNG, поэтому фронт может позиционировать боксы над слайдом
 * любого масштаба (мировой прямоугольник слайда на холсте, Э4.6) без
 * пересчёта под конкретный DPI.
 *
 * Не бинарники PDF в командной строке — `pdfPath` уже наш временный файл, а
 * не пользовательский ввод, но всё равно вызывается через `execFile` с
 * массивом аргументов (без shell), как и остальной пайплайн.
 *
 * Ошибка `pdftotext` (например, PDF без текстового слоя вообще — скан) не
 * валит конвертацию: слайды без текста просто не участвуют в поиске.
 */
async function extractTextLayers(pdfPath: string, totalPages: number): Promise<SlideTextBox[][]> {
  const layers: SlideTextBox[][] = Array.from({ length: totalPages }, () => []);
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("pdftotext", ["-bbox", pdfPath, "-"], {
      timeout: PDFTOTEXT_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
    }));
  } catch (err) {
    log("warn", "pdftotext -bbox не сработал — слайды без текстового слоя для поиска", {
      pdfPath,
      err: String(err),
    });
    return layers;
  }

  const pageRe = /<page[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g;
  const wordRe =
    /<word[^>]*\bxMin="([\d.-]+)"[^>]*\byMin="([\d.-]+)"[^>]*\bxMax="([\d.-]+)"[^>]*\byMax="([\d.-]+)"[^>]*>([^<]*)<\/word>/g;

  let pageIndex = 0;
  let pm: RegExpExecArray | null;
  while ((pm = pageRe.exec(stdout)) && pageIndex < totalPages) {
    const pageWidth = Number(pm[1]);
    const pageHeight = Number(pm[2]);
    const body = pm[3]!;
    const boxes: SlideTextBox[] = [];
    if (pageWidth > 0 && pageHeight > 0) {
      wordRe.lastIndex = 0;
      let wm: RegExpExecArray | null;
      while ((wm = wordRe.exec(body))) {
        const text = decodeXmlEntities(wm[5]!).trim();
        if (!text) continue;
        const xMin = Number(wm[1]);
        const yMin = Number(wm[2]);
        const xMax = Number(wm[3]);
        const yMax = Number(wm[4]);
        boxes.push({
          text,
          x: xMin / pageWidth,
          y: yMin / pageHeight,
          w: (xMax - xMin) / pageWidth,
          h: (yMax - yMin) / pageHeight,
        });
      }
    }
    layers[pageIndex] = boxes;
    pageIndex++;
  }
  return layers;
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
  log("info", "conversion start", { deckId: data.deckId, mime: data.sourceMimeType });

  await clamScan(src);

  // Э4.7: PDF отдаётся браузеру как есть — только считаем страницы, не рендерим.
  // Растеризации нет → и tmpfs-каталог под LibreOffice не нужен.
  if (data.sourceMimeType === "application/pdf") {
    const pages = await pdfPageCount(src);
    if (pages < 1) throw new Error("В PDF нет страниц");
    if (pages > MAX_SLIDES) {
      throw new Error(`Слишком много страниц: ${pages} (максимум ${MAX_SLIDES})`);
    }
    log("info", "pdf passthrough — растеризация пропущена", { deckId: data.deckId, pages });
    await onProgress({ done: pages, total: pages });
    return { slideCount: pages, slides: [], pdf: true };
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "deck-"));
  log("info", "office → pdf", { deckId: data.deckId, workDir });

  try {
    const pdfPath = await officeToPdf(src, workDir);

    const total = await pdfPageCount(pdfPath);
    if (total < 1) throw new Error("В документе нет страниц");
    if (total > MAX_SLIDES) {
      throw new Error(`Слишком много слайдов: ${total} (максимум ${MAX_SLIDES})`);
    }

    const textLayers = await extractTextLayers(pdfPath, total);

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

      const textLayer = textLayers[page - 1] ?? [];
      slides.push({
        index: page - 1,
        imageStorageKey: image.storageKey,
        thumbStorageKey: thumb.storageKey,
        width,
        height,
        textLayer: textLayer.length > 0 ? textLayer : null,
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
