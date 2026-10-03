import { useCallback, useEffect, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { ChevronRight, Maximize2, Pause, Play, SlidersHorizontal } from "lucide-react";
import type { PublicMaterial } from "@school/shared";

import { cn } from "@/lib/utils";
import { sanitizeHtml } from "@/shared/sanitize-html";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { RecordingPlayer } from "@/features/recordings/RecordingPlayer.js";
import { getAssetUrl } from "../materials-api.js";

type Block = PublicMaterial["blocks"][number];
export type ContentBlock = Exclude<Block, { type: "question" }>;

/** Класс ряда для блока: от него зависят отбивки (см. textbook.css). */
export function rowKind(block: Block): string {
  switch (block.type) {
    case "question":
      return "tb-row--task";
    case "image":
    case "video":
    case "embed":
      return "tb-row--figure";
    case "audio":
      return "tb-row--media";
    case "table":
      return "tb-row--table";
    case "formula":
      return "tb-row--formula";
    case "callout":
    case "spoiler":
      return "tb-row--aside";
    case "rich_text":
      return "tb-row--text";
    default:
      return "";
  }
}

const CALLOUT_LABEL = { note: "Заметка", warning: "Важно", example: "Пример" } as const;

export function TextbookContentBlock({
  block,
  figureNumber,
  formulaNumber,
}: {
  block: ContentBlock;
  figureNumber?: number;
  formulaNumber?: number;
}) {
  switch (block.type) {
    case "rich_text":
      return <Prose html={block.html} />;
    case "callout":
      return (
        <aside className={cn("tb-callout", `tb-callout--${block.variant}`)}>
          <span className="tb-callout-label">{CALLOUT_LABEL[block.variant]}</span>
          <Prose html={block.html} className="tb-aside-text" />
        </aside>
      );
    case "spoiler":
      return <Reveal title={block.title} html={block.html} />;
    case "table":
      return <DataTable rows={block.rows} />;
    case "formula":
      return <Formula latex={block.latex} number={formulaNumber} />;
    case "image":
      return <Figure block={block} number={figureNumber} />;
    case "video":
      return <Video assetId={block.assetId} />;
    case "audio":
      return <Audio assetId={block.assetId} transcript={block.transcript} />;
    case "embed":
      return (
        <div className="tb-embed">
          <div className="tb-embed-head">
            <SlidersHorizontal aria-hidden />
            Модель
            <span>{EMBED_NAME[block.provider]}</span>
          </div>
          <div className="tb-media-wait min-h-[8rem] rounded-none">
            Модель {EMBED_NAME[block.provider]} здесь пока не показывается
          </div>
        </div>
      );
    case "page_break":
      return null;
  }
}

const EMBED_NAME = { geogebra: "GeoGebra", desmos: "Desmos", jsxgraph: "JSXGraph" } as const;

/** Таблица: первая строка — шапка. */
function DataTable({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows;
  return (
    <div className="tb-table-wrap">
      <table className="tb-table">
        {head && body.length > 0 ? (
          <thead>
            <tr>
              {head.map((cell, ci) => (
                <th key={ci} scope="col">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {(head && body.length > 0 ? body : rows).map((row, ri) => (
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
}

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
    <div className="tb-spoiler">
      <button
        type="button"
        className="tb-spoiler-btn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight aria-hidden />
        {title}
      </button>
      {open ? (
        <div className="tb-spoiler-body">
          <Prose html={html} />
        </div>
      ) : null}
    </div>
  );
}

function Formula({ latex, number }: { latex: string; number?: number }) {
  let html: string;
  try {
    html = katex.renderToString(latex, { throwOnError: false, displayMode: true });
  } catch {
    html = `<span class="text-destructive">Формулу не удалось показать</span>`;
  }
  return (
    <div className="tb-formula">
      <span />
      <div className="tb-formula-body" dangerouslySetInnerHTML={{ __html: html }} />
      <span className="tb-formula-no">{number ? `(${number})` : null}</span>
    </div>
  );
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
            <div className="tb-figure-frame">
              <button
                type="button"
                className="tb-zoom"
                onClick={() => setZoomed(true)}
                aria-label={`${label}: открыть крупно`}
              >
                <img src={url} alt={block.caption ?? ""} />
              </button>
              <span className="tb-zoom-badge" aria-hidden>
                <Maximize2 />
              </span>
            </div>
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
          <div className="tb-figure-frame">
            <img src={url} alt={block.caption ?? ""} />
          </div>
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
    <div className="tb-video">
      <RecordingPlayer src={url} hotkeys="focus" playLabel="Смотреть видео" className="w-full" />
    </div>
  );
}

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

/** Аудио из медиатеки: кнопка, полоса перемотки и время; расшифровка по запросу. */
function Audio({ assetId, transcript }: { assetId: string; transcript?: string }) {
  const { url, error, retry } = useAssetUrl(assetId);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ now: 0, total: 0 });
  const ref = useRef<HTMLAudioElement>(null);

  if (!url) return <MediaWait what="аудио" error={error} onRetry={retry} />;

  const pct = time.total > 0 ? Math.min(100, (time.now / time.total) * 100) : 0;
  const seekBy = (delta: number) => {
    const el = ref.current;
    if (el) el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + delta));
  };

  return (
    <div className="tb-audio">
      <audio
        ref={ref}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setTime((t) => ({ ...t, total: e.currentTarget.duration }))}
        onTimeUpdate={(e) => setTime({ now: e.currentTarget.currentTime, total: e.currentTarget.duration })}
      />
      <div className="tb-audio-row">
        <button
          type="button"
          className="tb-audio-play"
          aria-label={playing ? "Пауза" : "Слушать"}
          onClick={() => {
            const el = ref.current;
            if (!el) return;
            if (el.paused) void el.play();
            else el.pause();
          }}
        >
          {playing ? <Pause aria-hidden /> : <Play aria-hidden className="ml-0.5" />}
        </button>
        <div className="tb-audio-body">
          <span className="tb-audio-name">Аудио</span>
          <div
            className="tb-audio-seek"
            role="slider"
            tabIndex={0}
            aria-label="Перемотка"
            aria-valuemin={0}
            aria-valuemax={Math.round(time.total) || 0}
            aria-valuenow={Math.round(time.now)}
            aria-valuetext={`${formatClock(time.now)} из ${formatClock(time.total)}`}
            onPointerDown={(e) => {
              const el = ref.current;
              if (!el || !el.duration) return;
              const r = e.currentTarget.getBoundingClientRect();
              el.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * el.duration;
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") seekBy(5);
              else if (e.key === "ArrowLeft") seekBy(-5);
              else return;
              e.preventDefault();
            }}
          >
            <span className="tb-audio-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <span className="tb-audio-time">
          {formatClock(time.now)} / {formatClock(time.total)}
        </span>
      </div>
      {transcript ? (
        <>
          <button
            type="button"
            className="tb-textbtn tb-textbtn--quiet self-start"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronRight className="tb-turn" aria-hidden />
            Текст аудио
          </button>
          {open ? <p className="tb-prose whitespace-pre-wrap text-[15px]">{transcript}</p> : null}
        </>
      ) : null}
    </div>
  );
}
