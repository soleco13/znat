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
  // Подзаголовки внутри rich_text (Э13, редактор-«лист»). Только h2/h3 —
  // h1 — это заголовок самого материала (`material.title`), внутри текста
  // блока не нужен; глубже h3 методисту в линейном материале незачем.
  "h2",
  "h3",
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

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "target", "rel"],
  });
}
