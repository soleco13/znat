import { useEffect, useMemo, useState } from "react";
import type { Deck } from "@school/shared";
import { getPdfPageTexts } from "./pdf.js";

/**
 * Э4.8, §3.5 ТЗ: «текстовый слой из pdftotext -bbox: поиск по презентации».
 * Ищет среди слайдов, уже импортированных на холст (`Board.tsx#slidePages`).
 *
 * Источник текста слайда:
 * - `renderMode: "images"` — серверный текстовый слой (`deck.slides[i].textLayer`,
 *   склеенные слова из `pdftotext -bbox`, Э4.8);
 * - `renderMode: "pdf"` (Э4.7) — сервер текст не извлекает (см. комментарий в
 *   `services/converter/src/convert.ts`), текст берёт сам pdf.js в браузере
 *   (`getPdfPageTexts`, лениво и только когда есть запрос — не парсить 40
 *   страниц ради ленты миниатюр, которая и так уже есть).
 */

type SlideRef = { deckId: string; index: number; pdfUrl?: string };

function slideText(ref: SlideRef, decks: Deck[], pdfTextCache: Record<string, string>): string {
  if (ref.pdfUrl) return pdfTextCache[`${ref.deckId}:${ref.index}`] ?? "";
  const deck = decks.find((d) => d.id === ref.deckId);
  const textLayer = deck?.slides.find((s) => s.index === ref.index)?.textLayer;
  return textLayer ? textLayer.map((b) => b.text).join(" ") : "";
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function SlideSearch({
  slides,
  decks,
  onJump,
}: {
  /** Страницы-слайды сейчас на холсте, в порядке ленты миниатюр. */
  slides: Array<{ pageId: string; slideNumber: number; ref: SlideRef }>;
  decks: Deck[];
  onJump: (pageId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [pdfTextCache, setPdfTextCache] = useState<Record<string, string>>({});

  const pdfDeckUrls = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of slides) if (s.ref.pdfUrl) map.set(s.ref.deckId, s.ref.pdfUrl);
    return map;
  }, [slides]);

  useEffect(() => {
    if (query.trim().length < 2) return;
    for (const [deckId, pdfUrl] of pdfDeckUrls) {
      if (`${deckId}:0` in pdfTextCache) continue; // уже проиндексирован (или пуст)
      getPdfPageTexts(pdfUrl)
        .then((texts) => {
          setPdfTextCache((prev) => {
            const next = { ...prev };
            texts.forEach((t, i) => {
              next[`${deckId}:${i}`] = t;
            });
            return next;
          });
        })
        .catch(() => undefined);
    }
  }, [query, pdfDeckUrls, pdfTextCache]);

  if (slides.length === 0) return null;

  const q = query.trim().toLocaleLowerCase("ru");
  const matches =
    q.length < 2
      ? []
      : slides.filter((s) => slideText(s.ref, decks, pdfTextCache).toLocaleLowerCase("ru").includes(q));

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск по слайдам…"
        className="rounded border px-2 py-1 text-sm"
      />
      {q.length >= 2 && (
        <span className="text-xs text-slate-500">
          {matches.length === 0
            ? "Не найдено"
            : `${matches.length} ${plural(matches.length, "совпадение", "совпадения", "совпадений")}:`}
        </span>
      )}
      {matches.map((m) => (
        <button
          key={m.pageId}
          onClick={() => onJump(m.pageId)}
          className="rounded border px-2 py-0.5 text-xs"
        >
          Слайд {m.slideNumber}
        </button>
      ))}
    </div>
  );
}
