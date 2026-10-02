import { useCallback, useEffect, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { ChevronRight } from "lucide-react";
import type { PublicMaterial } from "@school/shared";

import { cn } from "@/lib/utils";
import { sanitizeHtml } from "@/shared/sanitize-html";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { RecordingPlayer } from "@/features/recordings/RecordingPlayer.js";
import { getAssetUrl } from "../materials-api.js";

type Block = PublicMaterial["blocks"][number];
export type ContentBlock = Exclude<Block, { type: "question" }>;

/** Класс ряда для блока: от него зависят отбивки и ширина (см. textbook.css). */
export function rowKind(block: Block): string {
  switch (block.type) {
    case "question":
      return "tb-row--task";
    case "image":
    case "video":
    case "embed":
      return "tb-row--figure tb-row--wide";
    case "audio":
      return "tb-row--media";
    case "callout":
      return "tb-row--aside";
    case "rich_text":
      return "tb-row--text";
    default:
      return "";
  }
}

/** Содержимое поля слева от блока (метка врезки, «Аудио»), или null. */
export function marginFor(block: ContentBlock): React.ReactNode {
  switch (block.type) {
    case "callout":
      return (
        <span className={cn("tb-label", block.variant === "warning" && "tb-label--warning")}>
          {CALLOUT_LABEL[block.variant]}
        </span>
      );
    case "audio":
      return <span className="tb-label">Аудио</span>;
    default:
      return null;
  }
}

const CALLOUT_LABEL = { note: "Заметка", warning: "Важно", example: "Пример" } as const;

export function TextbookContentBlock({
  block,
  figureNumber,
}: {
  block: ContentBlock;
  figureNumber?: number;
}) {
  switch (block.type) {
    case "rich_text":
      return <Prose html={block.html} />;
    case "callout":
      return block.variant === "example" ? (
        <div className="tb-example">
          <Prose html={block.html} className="tb-aside-text" />
        </div>
      ) : (
        <Prose html={block.html} className="tb-aside-text" />
      );
    case "spoiler":
      return <Reveal title={block.title} html={block.html} />;
    case "table":
      return (
        <div className="tb-table-wrap">
          <table className="tb-table">
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "formula":
      return <Formula latex={block.latex} />;
    case "image":
      return <Figure block={block} number={figureNumber} />;
    case "video":
      return <Video assetId={block.assetId} />;
    case "audio":
      return <Audio assetId={block.assetId} transcript={block.transcript} />;
    case "embed":
      return (
        <div className="tb-media-wait min-h-[8rem]">
          Модель {EMBED_NAME[block.provider]} здесь пока не показывается
        </div>
      );
    case "page_break":
      return null;
  }
}

const EMBED_NAME = { geogebra: "GeoGebra", desmos: "Desmos", jsxgraph: "JSXGraph" } as const;

function Prose({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn("prose tb-prose", className)}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  );
}

/** Спойлер: «Показать решение» раскрывает текст прямо под собой. */
function Reveal({ title, html }: { title: string; html: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className="tb-textbtn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight aria-hidden />
        {title}
      </button>
      {open ? (
        <div className="tb-reveal">
          <Prose html={html} />
        </div>
      ) : null}
    </div>
  );
}

function Formula({ latex }: { latex: string }) {
  let html: string;
  try {
    html = katex.renderToString(latex, { throwOnError: false, displayMode: true });
  } catch {
    html = `<span class="text-destructive">Формулу не удалось показать</span>`;
  }
  return <div className="tb-formula" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Подписанная ссылка на файл медиатеки; `retry` — повторить после ошибки сети. */
function useAssetUrl(assetId: string) {
  const [state, setState] = useState<{ url: string | null; error: boolean }>({
    url: null,
    error: false,
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ url: null, error: false });
    getAssetUrl(assetId)
      .then((res) => !cancelled && setState({ url: res.url, error: false }))
      .catch(() => !cancelled && setState({ url: null, error: true }));
    return () => {
      cancelled = true;
    };
  }, [assetId, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

function MediaWait({ what, error, onRetry }: { what: string; error: boolean; onRetry: () => void }) {
  if (!error) return <div className="tb-media-wait">Загружаем {what}…</div>;
  return (
    <div className="tb-media-wait" role="alert">
      <div>
        <p>Не получилось загрузить {what}.</p>
        <button type="button" className="tb-textbtn" onClick={onRetry}>
          Попробовать ещё раз
        </button>
      </div>
    </div>
  );
}

function Figure({
  block,
  number,
}: {
  block: Extract<ContentBlock, { type: "image" }>;
  number?: number;
}) {
  const { url, error, retry } = useAssetUrl(block.assetId);
  const [zoomed, setZoomed] = useState(false);
  const label = number ? `Рис. ${number}` : "Рисунок";

  return (
    <figure className="tb-figure">
      {url ? (
        block.zoomable ? (
          <>
            <button
              type="button"
              className="tb-zoom"
              onClick={() => setZoomed(true)}
              aria-label={`${label}: открыть крупно`}
            >
              <img src={url} alt={block.caption ?? ""} />
            </button>
            <Dialog open={zoomed} onOpenChange={setZoomed}>
              <DialogContent className="max-w-[min(96vw,1200px)] gap-2 p-3 pt-12">
                <DialogTitle className="sr-only">{block.caption ?? label}</DialogTitle>
                <img
                  src={url}
                  alt={block.caption ?? ""}
                  className="mx-auto max-h-[82vh] w-auto max-w-full"
                />
                {block.caption ? (
                  <p className="text-center text-sm text-text-2">{block.caption}</p>
                ) : null}
              </DialogContent>
            </Dialog>
          </>
        ) : (
          <img src={url} alt={block.caption ?? ""} />
        )
      ) : (
        <MediaWait what="изображение" error={error} onRetry={retry} />
      )}
      {block.caption || number ? (
        <figcaption className="tb-caption">
          <b>{label}.</b> {block.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * Видео из медиатеки — плеер записей урока. Старые блоки со ссылкой вместо
 * id медиатеки CSP не пустит, для них честная заглушка (как в `ContentBlockView`).
 */
const MEDIA_ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Video({ assetId }: { assetId: string }) {
  if (!MEDIA_ASSET_ID.test(assetId)) {
    return <div className="tb-media-wait">Это видео здесь не открывается</div>;
  }
  return <LibraryVideo assetId={assetId} />;
}

function LibraryVideo({ assetId }: { assetId: string }) {
  const { url, error, retry } = useAssetUrl(assetId);
  if (!url) return <MediaWait what="видео" error={error} onRetry={retry} />;
  return (
    <RecordingPlayer src={url} hotkeys="focus" playLabel="Смотреть видео" className="w-full rounded" />
  );
}

function Audio({ assetId, transcript }: { assetId: string; transcript?: string }) {
  const { url, error, retry } = useAssetUrl(assetId);
  const [open, setOpen] = useState(false);
  return (
    <div>
      {url ? (
        <audio src={url} controls preload="metadata" className="w-full" />
      ) : (
        <MediaWait what="аудио" error={error} onRetry={retry} />
      )}
      {transcript ? (
        <>
          <button
            type="button"
            className="tb-textbtn"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronRight aria-hidden />
            Текст записи
          </button>
          {open ? <p className="tb-prose whitespace-pre-wrap">{transcript}</p> : null}
        </>
      ) : null}
    </div>
  );
}
