import { describe, expect, it } from "vitest";

import { escapeHtml, renderEmail } from "./template.js";

const content = {
  subject: "Сброс пароля в Матисе",
  preheader: "Ссылка действует 1 час.",
  heading: "Задайте новый пароль",
  paragraphs: ["Мы получили запрос <на> сброс."],
  button: { label: "Задать новый пароль", url: "https://matis-edu.ru/reset-password?token=a&b=<x>" },
  note: "Ссылка действует 1 час.",
};

describe("renderEmail", () => {
  it("экранирует текст и ссылку, кнопка ведёт на ту же ссылку, что и запасная", () => {
    const { html } = renderEmail(content, "https://matis-edu.ru/");
    expect(html).toContain("Мы получили запрос &lt;на&gt; сброс.");
    expect(html).not.toContain("<x>");
    const href = 'href="https://matis-edu.ru/reset-password?token=a&amp;b=&lt;x&gt;"';
    expect(html.split(href).length - 1).toBe(2);
    expect(html).toContain('src="https://matis-edu.ru/email/matis-mark.png"');
  });

  it("текстовая версия содержит ссылку целиком", () => {
    const { text } = renderEmail(content, "https://matis-edu.ru");
    expect(text).toContain("Задать новый пароль: https://matis-edu.ru/reset-password?token=a&b=<x>");
    expect(text).toContain("Ссылка действует 1 час.");
  });

  it("escapeHtml", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
