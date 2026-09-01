/**
 * Э4.7, §3.5 ТЗ: рендер страниц PDF в браузере через pdf.js. Прямая загрузка
 * PDF минует серверную растеризацию (конвертер только сканирует ClamAV и
 * считает страницы) — картинку каждой страницы строит клиент отсюда.
 *
 * Воркер pdf.js бандлится Vite локально (`?worker`), ничего с чужих CDN
 * (железное правило CLAUDE.md). Исходник грузим одним `fetch` в ArrayBuffer
 * и отдаём pdf.js как `data`: наш `/files/*` не поддерживает Range-запросы,
 * а pdf.js по URL пытается качать диапазонами.
 */
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

/** Одна презентация парсится один раз — миниатюры и полноразмерный слайд делят документ. */
const docCache = new Map<string, Promise<PDFDocumentProxy>>();

function loadPdf(url: string): Promise<PDFDocumentProxy> {
  let doc = docCache.get(url);
  if (!doc) {
    doc = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`PDF ${res.status}`);
      const buf = await res.arrayBuffer();
      return pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    })();
    docCache.set(url, doc);
    void doc.catch(() => docCache.delete(url));
  }
  return doc;
}

/**
 * Рендер страниц — по 2 за раз. Лента миниатюр презентации на 40 страниц
 * иначе создаёт 40 canvas разом (всплеск памяти); pdf.js-воркер их всё равно
 * сериализует, так что очередь почти ничего не стоит.
 */
let active = 0;
const waiting: Array<() => void> = [];
function acquire(): Promise<void> {
  if (active < 2) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}
function release(): void {
  active--;
  const next = waiting.shift();
  if (next) {
    active++;
    next();
  }
}

export type PdfPageSize = { width: number; height: number };

/** Размеры всех страниц (мировые единицы = pt при scale 1) — для раскладки страниц холста. */
export async function getPdfPageSizes(url: string): Promise<PdfPageSize[]> {
  const pdf = await loadPdf(url);
  const sizes: PdfPageSize[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    sizes.push({ width: Math.round(vp.width), height: Math.round(vp.height) });
  }
  return sizes;
}

/**
 * Э4.8: весь текст каждой страницы (без bbox — просто для полнотекстового
 * поиска по презентации). Только для `renderMode: "pdf"` (Э4.7): у этих
 * презентаций нет серверного текстового слоя (`pdftotext -bbox` там не
 * гоняется — см. `services/converter/src/convert.ts`), а pdf.js и так парсит
 * страницу целиком для рендера, так что второй раз лезть на сервер незачем.
 */
export async function getPdfPageTexts(url: string): Promise<string[]> {
  const pdf = await loadPdf(url);
  const texts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    texts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return texts;
}

/**
 * Рендерит одну страницу (0-based) в PNG data-URL шириной `targetWidthPx`.
 * Дальше эту картинку позиционирует/масштабирует тот же слой фона, что и
 * серверный PNG-слайд (`PageBackground`), — CSS-масштаб как у PNG@2x.
 */
export async function renderPdfPage(
  url: string,
  pageIndex: number,
  targetWidthPx: number,
): Promise<string> {
  const pdf = await loadPdf(url);
  const page = await pdf.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.max(1, targetWidthPx / base.width) });

  await acquire();
  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context недоступен");

    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/png");
  } finally {
    release();
  }
}
