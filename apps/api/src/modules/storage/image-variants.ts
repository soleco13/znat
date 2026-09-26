import sharp from "sharp";

/**
 * Облегчённые варианты картинок доски — по параметру `v` подписанной ссылки
 * `/files/*`, без изменения самих досок (ссылки на картинки лежат в Y.Doc):
 *  - `web`  — WebP q90 в полном размере. Картинки, загруженные до перехода на
 *    WebP, лежат PNG до 2,8 МБ; в WebP они в 3–13 раз легче на вид без потерь.
 *    Уже WebP отдаётся как есть.
 *  - `lite` — до `LITE_MAX_SIDE` по большей стороне, WebP q70: для участника со
 *    слабой связью (решает клиент доски, board-link.ts).
 *
 * Готовые варианты — в памяти процесса, в ограниченном кэше (потерять не
 * страшно — пересчитаются), вытесняются самые давние.
 */

export const IMAGE_VARIANTS = ["web", "lite"] as const;
export type ImageVariant = (typeof IMAGE_VARIANTS)[number];

const LITE_MAX_SIDE = 1000;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const IMAGE_KEY = /\.(png|jpe?g|webp)$/i;

const cache = new Map<string, Buffer>();
let cachedBytes = 0;
/** Уже считающиеся варианты: ученики входят разом и просят одну и ту же картинку. */
const inFlight = new Map<string, Promise<Buffer>>();

export function isImageVariant(value: unknown): value is ImageVariant {
  return typeof value === "string" && (IMAGE_VARIANTS as readonly string[]).includes(value);
}

export function supportsImageVariant(storageKey: string): boolean {
  return IMAGE_KEY.test(storageKey);
}

function remember(key: string, data: Buffer): void {
  if (data.length > CACHE_MAX_BYTES / 4) return;
  cache.set(key, data);
  cachedBytes += data.length;
  for (const [oldKey, oldData] of cache) {
    if (cachedBytes <= CACHE_MAX_BYTES) break;
    cache.delete(oldKey);
    cachedBytes -= oldData.length;
  }
}

/** `null` — вариант не нужен (уже WebP для `web`): отдавать исходник. */
export async function renderImageVariant(
  storageKey: string,
  variant: ImageVariant,
  readOriginal: () => Promise<Buffer>,
): Promise<Buffer | null> {
  if (variant === "web" && /\.webp$/i.test(storageKey)) return null;
  const cacheKey = `${variant}:${storageKey}`;
  const hit = cache.get(cacheKey);
  if (hit) {
    // Обновляем «свежесть» записи для вытеснения по давности.
    cache.delete(cacheKey);
    cache.set(cacheKey, hit);
    return hit;
  }
  const running = inFlight.get(cacheKey);
  if (running) return running;
  const render = (async () => {
    let pipeline = sharp(await readOriginal()).rotate();
    if (variant === "lite") {
      pipeline = pipeline.resize({ width: LITE_MAX_SIDE, height: LITE_MAX_SIDE, fit: "inside", withoutEnlargement: true });
    }
    const data = await pipeline.webp({ quality: variant === "lite" ? 70 : 90, smartSubsample: true }).toBuffer();
    remember(cacheKey, data);
    return data;
  })();
  inFlight.set(cacheKey, render);
  try {
    return await render;
  } finally {
    inFlight.delete(cacheKey);
  }
}

/** Только для тестов. */
export function clearImageVariantCache(): void {
  cache.clear();
  inFlight.clear();
  cachedBytes = 0;
}
