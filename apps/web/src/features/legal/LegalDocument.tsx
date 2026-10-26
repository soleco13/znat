import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { BrandMark } from "@/shared/ui/brand-mark";

/**
 * Юридические тексты лежат в `texts/*.md`: их читает и владелец, и юрист, а
 * сайт показывает те же файлы. Зависимость для Markdown не нужна — тексты
 * используют небольшую часть разметки: `#`/`##`/`###`, абзацы, списки `- `,
 * таблицы, `> ` цитата, `---`, **жирный** и [ссылки](url).
 */
const ORIGIN = "https://matis-edu.ru";

/**
 * Путь внутри приложения для ссылки на наш сайт. Главная страница и её якоря
 * (`/#pricing`) — это лендинг, он не часть SPA: такие ссылки открываются
 * обычным переходом, а не через роутер.
 */
function internalPath(url: string): string | null {
  const path = url.startsWith(ORIGIN + "/") ? url.slice(ORIGIN.length) : url.startsWith("/") ? url : null;
  if (path === null || path === "/" || path.startsWith("/#")) return null;
  return path;
}

type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "hr" };

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: "h", level: h[1]!.length as 1 | 2 | 3, text: h[2]! });
      i += 1;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) {
        rows.push(splitRow(lines[i]!));
        i += 1;
      }
      const head = rows[0] ?? [];
      const body = rows.slice(1).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
      blocks.push({ kind: "table", head: head.every((c) => !c) ? [] : head, rows: body });
      continue;
    }
    if (/^\s*- /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*- /.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*- /, ""));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (line.startsWith(">")) {
      const parts: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) {
        parts.push(lines[i]!.replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", text: parts.join(" ").trim() });
      continue;
    }
    // Абзац: идущие подряд строки склеиваются.
    const parts: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,3}\s|---+\s*$|\||\s*- |>)/.test(lines[i]!)) {
      parts.push(lines[i]!.trim());
      i += 1;
    }
    blocks.push({ kind: "p", text: parts.join(" ") });
  }
  return blocks;
}

/** **жирный** и [текст](ссылка); ссылки на наш сайт — внутренние. */
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(
        <strong key={key++} className="font-semibold text-foreground">
          {renderInline(m[1])}
        </strong>,
      );
    } else {
      const label = m[2]!;
      const url = m[3]!;
      const internal = internalPath(url);
      out.push(
        internal ? (
          <Link key={key++} to={internal} className="font-medium text-primary underline-offset-2 hover:underline">
            {label}
          </Link>
        ) : (
          <a key={key++} href={url} className="font-medium text-primary underline-offset-2 hover:underline">
            {label}
          </a>
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Голые адреса https://… и почта в тексте тоже делаем ссылками. */
function linkify(nodes: ReactNode[]): ReactNode[] {
  const out: ReactNode[] = [];
  nodes.forEach((n, idx) => {
    if (typeof n !== "string") {
      out.push(n);
      return;
    }
    n.split(/(https?:\/\/[^\s)]+[^\s).,;]|[\w.+-]+@[\w-]+\.[\w.-]+[\w-])/g).forEach((p, j) => {
      const key = `${idx}-${j}`;
      if (/^https?:\/\//.test(p)) {
        const internal = p.startsWith(ORIGIN + "/") ? internalPath(p) : null;
        out.push(
          internal ? (
            <Link key={key} to={internal} className="font-medium text-primary underline-offset-2 hover:underline">
              {p}
            </Link>
          ) : (
            <a key={key} href={p} className="font-medium text-primary underline-offset-2 hover:underline">
              {p}
            </a>
          ),
        );
      } else if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(p)) {
        out.push(
          <a key={key} href={`mailto:${p}`} className="font-medium text-primary underline-offset-2 hover:underline">
            {p}
          </a>,
        );
      } else {
        out.push(<Fragment key={key}>{p}</Fragment>);
      }
    });
  });
  return out;
}

const inline = (text: string) => linkify(renderInline(text));

export function LegalText({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className="space-y-4 text-[15px] leading-[1.65] text-text-2">
      {blocks.map((b, idx) => {
        switch (b.kind) {
          case "h":
            if (b.level === 1) {
              return (
                <h1 key={idx} className="text-[28px] font-black leading-[1.15] tracking-[-.03em] text-foreground [text-wrap:balance] sm:text-[34px]">
                  {inline(b.text)}
                </h1>
              );
            }
            return b.level === 2 ? (
              <h2 key={idx} className="pt-4 text-xl font-bold tracking-[-.02em] text-foreground [text-wrap:balance]">
                {inline(b.text)}
              </h2>
            ) : (
              <h3 key={idx} className="pt-2 text-base font-bold text-foreground">
                {inline(b.text)}
              </h3>
            );
          case "p":
            return (
              <p key={idx} className="[text-wrap:pretty]">
                {inline(b.text)}
              </p>
            );
          case "ul":
            return (
              <ul key={idx} className="list-disc space-y-1.5 pl-6 marker:text-text-3">
                {b.items.map((it, j) => (
                  <li key={j} className="[text-wrap:pretty]">
                    {inline(it)}
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote key={idx} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                {inline(b.text)}
              </blockquote>
            );
          case "hr":
            return <hr key={idx} className="border-border" />;
          case "table":
            // На телефоне строка таблицы — карточка: подпись столбца над значением.
            return (
              <div key={idx} className="overflow-hidden rounded-lg border border-border bg-card">
                <table className="block w-full border-collapse text-left text-sm sm:table">
                  {b.head.length ? (
                    <thead className="hidden bg-background text-foreground sm:table-header-group">
                      <tr>
                        {b.head.map((c, j) => (
                          <th key={j} className="border-b border-border px-4 py-2.5 font-semibold">
                            {inline(c)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody className="block sm:table-row-group">
                    {b.rows.map((r, j) => (
                      <tr key={j} className="block space-y-2 border-b border-border p-4 last:border-b-0 sm:table-row sm:space-y-0 sm:p-0">
                        {r.map((c, k) => (
                          <td
                            key={k}
                            data-label={k > 0 ? b.head[k] : undefined}
                            className={
                              (k === 0 ? "font-medium text-foreground " : "") +
                              "block before:block before:text-xs before:text-text-3 before:content-[attr(data-label)] sm:table-cell sm:px-4 sm:py-2.5 sm:align-top sm:before:hidden"
                            }
                          >
                            {inline(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}

export const LEGAL_LINKS = [
  { to: "/terms", label: "Пользовательское соглашение" },
  { to: "/privacy", label: "Политика обработки персональных данных" },
  { to: "/consent", label: "Согласие на обработку данных" },
  { to: "/requisites", label: "Реквизиты" },
] as const;

/** Ссылки на документы — под формами входа и регистрации, в подвале страниц документов. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Документы" className={className}>
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {[LEGAL_LINKS[0], LEGAL_LINKS[1], LEGAL_LINKS[3]].map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="underline-offset-2 hover:text-foreground hover:underline">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Страница документа: шапка со знаком, текст, ссылки на остальные документы. */
export function LegalPage({ source }: { source: string }) {
  return (
    <div className="min-h-dvh bg-background px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <Link to="/" className="inline-flex items-center gap-2.5 rounded-lg" aria-label="Матис, на главную">
            <BrandMark className="size-[30px] text-primary" />
            <span className="text-[16px] font-bold tracking-[-.02em]">Матис</span>
          </Link>
        </header>
        <article className="rounded-xl border border-border bg-card px-5 py-7 shadow-xs sm:px-10 sm:py-10">
          <LegalText source={source} />
        </article>
        <nav aria-label="Другие документы" className="mt-6">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {LEGAL_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="underline-offset-2 hover:text-foreground hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <Link to="/consent/lesson" className="underline-offset-2 hover:text-foreground hover:underline">
                Согласие при входе в урок
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  );
}
