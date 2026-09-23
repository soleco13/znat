import { z } from "zod";

/**
 * Э14.1 — тип «пространства». `individual` — репетитор без организации
 * (в т.ч. без явно выбранного пространства — тогда это его личная школа
 * под капотом, не показывается пользователю как «пространство»);
 * `organization` — ООО, регистрирующее своё именованное пространство.
 */
export const schoolKindSchema = z.enum(["individual", "organization"]);
export type SchoolKind = z.infer<typeof schoolKindSchema>;

/** Публичная информация о пространстве — ответ `GET /spaces/:slug` (визитка ООО). */
export const schoolPublicInfoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  kind: schoolKindSchema,
});
export type SchoolPublicInfo = z.infer<typeof schoolPublicInfoSchema>;

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * Slug для пути `/s/<slug>/...`: транслитерация кириллицы, lowercase,
 * обрезка до `[a-z0-9-]`. Чистая функция — используется и на бэке (генерация
 * slug пространства с последующей проверкой на уникальность), и на фронте
 * (live-превью при вводе названия ООО). Не гарантирует уникальность сама
 * по себе — это забота вызывающего кода (retry с суффиксом).
 */
export function slugify(input: string): string {
  const transliterated = input
    .toLowerCase()
    .split("")
    .map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join("");
  return transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
