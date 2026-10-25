/**
 * Вёрстка писем Матиса (2026-10-25): шапка со знаком, белая карточка,
 * заголовок, одна кнопка и ссылка для копирования, если кнопка не открылась.
 *
 * Почтовые клиенты понимают только старый HTML: раскладка таблицами, стили
 * прямо в атрибутах `style`, без SVG и веб-шрифтов (Outlook, Mail.ru, Gmail
 * вырезают `<style>` и внешние шрифты). Кнопка — ячейка таблицы с фоном и
 * ссылкой внутри, чтобы её было видно и в Outlook. Цвета — токены
 * `apps/web/src/index.css` (`--c-primary`, `--c-text`, `--c-bg`…).
 *
 * Знак — PNG с нашего же домена (`/email/matis-mark.png`, исходник
 * `docs/brand/logo/01-mark.svg`); если картинки отключены, рядом остаётся
 * надпись «Матис».
 */

const C = {
  primary: "#1d4ed8",
  text: "#101828",
  text2: "#475467",
  text3: "#667085",
  bg: "#f6f7f9",
  surface: "#ffffff",
  border: "#e7eaef",
} as const;

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export interface EmailContent {
  /** Тема письма; она же `<title>`. */
  subject: string;
  /** Строка-превью в списке писем (после темы). */
  preheader: string;
  heading: string;
  /** Абзацы над кнопкой. */
  paragraphs: string[];
  button: { label: string; url: string };
  /** Мелкий текст под кнопкой: срок ссылки, «если это были не вы». */
  note: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** HTML и текстовая версия письма (текст — для клиентов без HTML и антиспама). */
export function renderEmail(content: EmailContent, origin: string): { html: string; text: string } {
  const e = escapeHtml;
  const url = e(content.button.url);
  const home = origin.replace(/\/+$/, "");
  const markUrl = e(`${home}/email/matis-mark.png`);

  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.55;color:${C.text2};">${e(p)}</p>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg};">${e(content.preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 8px 20px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding-right:10px;vertical-align:middle;"><img src="${markUrl}" width="32" height="32" alt="" style="display:block;border:0;width:32px;height:32px;"></td>
<td style="vertical-align:middle;font-family:${FONT};font-size:20px;font-weight:800;letter-spacing:-0.4px;color:${C.text};">Матис</td>
</tr></table>
</td></tr>
<tr><td style="background:${C.surface};border:1px solid ${C.border};border-radius:16px;padding:36px 32px 32px;">
<h1 style="margin:0 0 16px;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.5px;color:${C.text};">${e(content.heading)}</h1>
${paragraphs}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr>
<td align="center" bgcolor="${C.primary}" style="border-radius:10px;background:${C.primary};">
<a href="${url}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px;">${e(content.button.label)}</a>
</td></tr></table>
<p style="margin:0 0 24px;font-family:${FONT};font-size:14px;line-height:1.55;color:${C.text2};">${e(content.note)}</p>
<p style="margin:0;padding-top:20px;border-top:1px solid ${C.border};font-family:${FONT};font-size:13px;line-height:1.5;color:${C.text3};">Кнопка не открывается? Скопируйте ссылку в браузер:<br><a href="${url}" target="_blank" style="color:${C.primary};text-decoration:underline;word-break:break-all;">${url}</a></p>
</td></tr>
<tr><td style="padding:20px 8px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.text3};">Это автоматическое письмо, отвечать на него не нужно. <a href="${e(home)}" target="_blank" style="color:${C.text3};text-decoration:underline;">${e(home.replace(/^https?:\/\//, ""))}</a></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    content.heading,
    "",
    ...content.paragraphs.flatMap((p) => [p, ""]),
    `${content.button.label}: ${content.button.url}`,
    "",
    content.note,
    "",
    "Это автоматическое письмо, отвечать на него не нужно.",
    "Матис",
  ].join("\n");

  return { html, text };
}
