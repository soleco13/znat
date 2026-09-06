import DOMPurify from "dompurify";

/**
 * Санитайзация HTML из материалов (Э8.4, §6 ТЗ: `{html: "<p>...</p>"}` в
 * `prompt`/`hint`/`feedback`/вариантах ответов и т.д.). До Э9 (редактор)
 * материалы заводятся JSON-ом через seed-скрипт/Postman — без санитайзации
 * `dangerouslySetInnerHTML` был бы хранимым XSS: кто угодно с доступом к
 * БД/API мог бы вложить `<script>`/`onerror=` в JSON материала, оно
 * выполнилось бы в браузере каждого ученика, открывшего задание.
 *
 * Разрешённый набор тегов — то, что реально появляется в форматах §6 ТЗ
 * (`rich_text`/`callout`/`prompt`/`hint`/`feedback`/подписи вариантов):
 * структура текста и базовая разметка, никаких `script`/`iframe`/атрибутов
 * обработчиков событий. Формулы (`formula`-блок) рендерятся отдельно из
 * `latex`, не через этот HTML — KaTeX ещё не подключён (Э9), сюда не
 * относится.
 */
const ALLOWED_TAGS = [
  "p",
  "br",
  // Заголовки в rich_text (Э13, редактор-«лист» в духе Notion). h1 —
  // подзаголовок раздела внутри материала (не путать с `material.title`);
  // глубже h3 методисту в линейном материале незачем.
  "h1",
  "h2",
  "h3",
  "blockquote",
  "code",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "sub",
  "sup",
  "ul",
  "ol",
  "li",
  "a",
  "span",
];

/**
 * `style` разрешён (Э13) — редактор пишет `font-family`/`color` инлайном
 * (`<span style="…">`). DOMPurify по умолчанию вычищает опасное содержимое
 * `style` (`expression()`, `url(javascript:…)`), оставляя безопасные
 * CSS-свойства.
 */
const ALLOWED_ATTR = ["href", "target", "rel", "style"];

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  });
}
