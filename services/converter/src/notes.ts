/**
 * Заметки докладчика (Э4.9, §3.5 ТЗ): «видны только учителю». Извлекаются из
 * ИСХОДНОГО .pptx/.odp (не из промежуточного PDF — обычный `--convert-to pdf`
 * заметки не включает, а специальный режим экспорта «Notes Pages» рисует их
 * прямо в тело PDF как картинку/текст на том же листе, что и слайд — не
 * подходит: нам нужен текст ОТДЕЛЬНО от слайда, чтобы решать на сервере,
 * кому его показывать).
 *
 * И .pptx (OOXML), и .odp (ODF) — обычные ZIP-архивы с XML внутри. Ни один
 * ZIP/XML-парсер не добавлен в зависимости (`services/converter` с Э4.1
 * держится на нуле зависимостей) — свой минимальный ZIP-ридер (central
 * directory + local file header, `stored`/`deflate`, без ZIP64 — для файлов
 * презентаций это оправданный вырез) и точечные регэкспы по помеченным
 * фрагментам XML, тот же приём, что `pngSize()`/текстовый слой в Э4.3/Э4.8.
 *
 * Разбор ЛУЧШЕ ЭФФОРТ (best-effort): любая ошибка (битый архив, неожиданная
 * структура XML, ZIP64) не валит конвертацию — слайды просто остаются без
 * заметок (`notes: null`), в структурный лог уходит `warn`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const ODP_MIME = "application/vnd.oasis.opendocument.presentation";

function log(level: "warn", msg: string, extra?: Record<string, unknown>): void {
  const line = { ts: new Date().toISOString(), level, svc: "converter", msg, ...extra };
  process.stderr.write(`${JSON.stringify(line)}\n`);
}

// ─── Минимальный ZIP-ридер ──────────────────────────────────────────────

interface ZipEntry {
  method: number;
  compSize: number;
  offset: number;
}

/** Central directory ZIP-архива: имя записи → метаданные для чтения. */
function parseZipCentralDirectory(buf: Buffer): Map<string, ZipEntry> {
  const EOCD_SIG = 0x06054b50;
  const MIN_EOCD = 22;
  const scanFrom = Math.max(0, buf.length - MIN_EOCD - 65535);
  let eocdOffset = -1;
  for (let i = buf.length - MIN_EOCD; i >= scanFrom; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("не ZIP-архив (EOCD не найден)");

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  let cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) break; // central file header signature
    const method = buf.readUInt16LE(cdOffset + 10);
    const compSize = buf.readUInt32LE(cdOffset + 20);
    const nameLen = buf.readUInt16LE(cdOffset + 28);
    const extraLen = buf.readUInt16LE(cdOffset + 30);
    const commentLen = buf.readUInt16LE(cdOffset + 32);
    const localOffset = buf.readUInt32LE(cdOffset + 42);
    const name = buf.toString("utf8", cdOffset + 46, cdOffset + 46 + nameLen);
    entries.set(name, { method, compSize, offset: localOffset });
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntryBytes(buf: Buffer, entry: ZipEntry): Buffer {
  if (buf.readUInt32LE(entry.offset) !== 0x04034b50) {
    throw new Error("битый локальный заголовок ZIP");
  }
  const nameLen = buf.readUInt16LE(entry.offset + 26);
  const extraLen = buf.readUInt16LE(entry.offset + 28);
  const dataStart = entry.offset + 30 + nameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + entry.compSize);
  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) return inflateRawSync(compressed);
  throw new Error(`неподдерживаемый метод сжатия ZIP: ${entry.method}`);
}

function readZipText(buf: Buffer, zip: Map<string, ZipEntry>, name: string): string | null {
  const entry = zip.get(name);
  if (!entry) return null;
  return readZipEntryBytes(buf, entry).toString("utf8");
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// ─── OOXML (.pptx) ──────────────────────────────────────────────────────

function parseRelsMap(relsXml: string): Map<string, { target: string; type: string }> {
  const map = new Map<string, { target: string; type: string }>();
  const tagRe = /<Relationship\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(relsXml))) {
    const attrs = m[1]!;
    const id = attrs.match(/\bId="([^"]+)"/)?.[1];
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
    const type = attrs.match(/\bType="([^"]+)"/)?.[1] ?? "";
    if (id && target) map.set(id, { target, type });
  }
  return map;
}

/** Текст заметок из `notesSlideN.xml`: все текстовые прогоны, КРОМЕ плейсхолдеров
 *  номера слайда/даты/футера/картинки слайда (у них тот же `<p:sp>`, но не текст заметки). */
function extractNotesSlideText(xml: string): string {
  const SKIP_PH_TYPES = new Set(["sldNum", "dt", "ftr", "sldImg"]);
  const lines: string[] = [];
  const shapeRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
  let sm: RegExpExecArray | null;
  while ((sm = shapeRe.exec(xml))) {
    const shape = sm[1]!;
    const phType = shape.match(/<p:ph\b[^>]*\btype="([^"]+)"/)?.[1];
    if (phType && SKIP_PH_TYPES.has(phType)) continue;
    for (const p of shape.split(/<a:p[ >]/).slice(1)) {
      const line = [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)]
        .map((m) => decodeXmlEntities(m[1] ?? ""))
        .join("");
      if (line.trim()) lines.push(line);
    }
  }
  return lines.join("\n").trim();
}

/**
 * Порядок слайдов берём из `presentation.xml` (`p:sldIdLst`) — тот же
 * авторитетный порядок, в котором LibreOffice экспортирует страницы PDF
 * (значит, совпадает с 0-based `index` уже отрендеренных слайдов).
 */
function extractPptxNotes(buf: Buffer, zip: Map<string, ZipEntry>, totalSlides: number): (string | null)[] {
  const notes: (string | null)[] = Array.from({ length: totalSlides }, () => null);

  const presentationXml = readZipText(buf, zip, "ppt/presentation.xml");
  const presRelsXml = readZipText(buf, zip, "ppt/_rels/presentation.xml.rels");
  if (!presentationXml || !presRelsXml) return notes;

  const presRels = parseRelsMap(presRelsXml);
  const sldRIds = [...presentationXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => m[1]!);

  for (let i = 0; i < sldRIds.length && i < totalSlides; i++) {
    const slideRel = presRels.get(sldRIds[i]!);
    if (!slideRel) continue;
    const slidePath = path.posix.join("ppt", slideRel.target); // напр. "ppt/slides/slide3.xml"
    const slideName = path.posix.basename(slidePath);
    const slideRelsXml = readZipText(buf, zip, `ppt/slides/_rels/${slideName}.rels`);
    if (!slideRelsXml) continue;

    const slideRels = parseRelsMap(slideRelsXml);
    const notesRel = [...slideRels.values()].find((r) => r.type.endsWith("/notesSlide"));
    if (!notesRel) continue;

    const notesPath = path.posix.join("ppt/slides", notesRel.target);
    const notesXml = readZipText(buf, zip, notesPath);
    if (!notesXml) continue;

    const text = extractNotesSlideText(notesXml);
    notes[i] = text.length > 0 ? text : null;
  }
  return notes;
}

// ─── ODF (.odp) ─────────────────────────────────────────────────────────

/** У ODP заметки — дочерний `<presentation:notes>` прямо внутри `<draw:page>»,
 *  страницы в `content.xml` уже в порядке показа — не нужен отдельный rels-обход. */
function extractOdpPageNotes(pageXml: string): string {
  const notesXml = pageXml.match(/<presentation:notes\b[^>]*>([\s\S]*?)<\/presentation:notes>/)?.[1];
  if (!notesXml) return "";
  const lines = [...notesXml.matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)]
    .map((m) => decodeXmlEntities((m[1] ?? "").replace(/<[^>]+>/g, "")).trim())
    .filter((l) => l.length > 0);
  return lines.join("\n");
}

function extractOdpNotes(buf: Buffer, zip: Map<string, ZipEntry>, totalSlides: number): (string | null)[] {
  const notes: (string | null)[] = Array.from({ length: totalSlides }, () => null);
  const contentXml = readZipText(buf, zip, "content.xml");
  if (!contentXml) return notes;

  const pages = [...contentXml.matchAll(/<draw:page\b[^>]*>[\s\S]*?<\/draw:page>/g)].map((m) => m[0]);
  for (let i = 0; i < pages.length && i < totalSlides; i++) {
    const text = extractOdpPageNotes(pages[i]!);
    notes[i] = text.length > 0 ? text : null;
  }
  return notes;
}

// ─── Точка входа ────────────────────────────────────────────────────────

/**
 * `null` на всех позициях для .docx/.pdf (нет понятия «заметки докладчика»)
 * и при любой ошибке разбора — вызывающий код (`convert.ts`) ничего не
 * проверяет, просто складывает результат в `ConvertedSlide.notes`.
 */
export async function extractSpeakerNotes(
  sourcePath: string,
  mimeType: string,
  totalSlides: number,
): Promise<(string | null)[]> {
  const empty = () => Array.from({ length: totalSlides }, () => null);
  if (mimeType !== PPTX_MIME && mimeType !== ODP_MIME) return empty();

  try {
    const buf = await readFile(sourcePath);
    const zip = parseZipCentralDirectory(buf);
    return mimeType === PPTX_MIME
      ? extractPptxNotes(buf, zip, totalSlides)
      : extractOdpNotes(buf, zip, totalSlides);
  } catch (err) {
    log("warn", "не удалось извлечь заметки докладчика — слайды без заметок", {
      sourcePath,
      err: String(err),
    });
    return empty();
  }
}
