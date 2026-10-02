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

const ALLOWED_ATTR = ["href", "target", "rel", "style"];

/**
 * `style` разрешён (Э13) — редактор пишет `font-family`/`color` инлайном
 * (`<span style="…">`). Содержимое `style` DOMPurify НЕ разбирает: проходили
 * `url(…)` (запрос на любой адрес — в т.ч. из Chrome записи урока, который
 * живёт в сети сервера) и `position: fixed` (материал перекрывал страницу
 * ученика поддельным интерфейсом). Оставляем только оформление текста.
 */
const ALLOWED_STYLE_PROPS = new Set([
  "color",
  "background-color",
  "font-family",
  "font-weight",
  "font-style",
  "text-decoration",
  "text-align",
]);
const SAFE_STYLE_VALUE = /^[\w\s#%.,()'"-]+$/;

function filterStyle(style: string): string {
  return style
    .split(";")
    .map((decl) => {
      const colon = decl.indexOf(":");
      if (colon < 0) return null;
      const prop = decl.slice(0, colon).trim().toLowerCase();
      const value = decl.slice(colon + 1).trim();
      if (!ALLOWED_STYLE_PROPS.has(prop) || !SAFE_STYLE_VALUE.test(value) || /url\s*\(|expression/i.test(value)) {
        return null;
      }
      return `${prop}: ${value}`;
    })
    .filter((decl): decl is string => decl !== null)
    .join("; ");
}

DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName !== "style") return;
  const filtered = filterStyle(data.attrValue);
  if (filtered) data.attrValue = filtered;
  else data.keepAttr = false;
});

// Ссылка из материала в новой вкладке не получает доступ к нашей (`window.opener`).
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("target")) {
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  });
}
