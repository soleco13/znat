import { useRef, useState } from "react";
import {
  useParticipants,
  useSpeakingParticipants,
  useTracks,
  VideoTrack,
} from "@livekit/components-react";
import { ConnectionQuality, Track } from "livekit-client";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Hand, Loader2, MicOff, Pin, SignalLow } from "lucide-react";
import type { LessonMode, ParticipantSnapshot } from "@school/shared";

import { cn } from "@/lib/utils";
import { initialsOf } from "@/shared/ui/avatar";
import { participantsCount } from "./format.js";
import { useSelfCameraUiStore } from "./self-camera-ui-store.js";
import { useAdaptiveGrid } from "./use-adaptive-grid.js";
import { useIsNarrowViewport } from "./use-narrow-viewport.js";
import { useRoomIdentity } from "./use-room-identity.js";

const GAP = 10;
const PAGE_SIZE = 12;
const RAIL_VISIBLE = 5;
const STRIP_VISIBLE = 4;

const ROLE_SUFFIX: Record<string, string> = {
  teacher: "учитель",
  admin: "администратор",
  methodist: "методист",
};

type TileSize = "lg" | "md" | "sm" | "xs";

/**
 * Плитки участников урока.
 *  - `variant="grid"` — на весь стейдж: 16:9, размер подбирает `useAdaptiveGrid`;
 *    больше 12 — постранично с плиткой «+N». На телефоне — говорящий во всю
 *    высоту и лента 3:4 под ним.
 *  - `variant="rail"` — узкая колонка 190px рядом с доской/демонстрацией
 *    (на телефоне — та же лента 3:4 под главным блоком).
 */
export function RoomVideoGrid({
  participants,
  selfId,
  variant = "grid",
  layout = "grid",
  onLayoutChange,
  onShowAll,
}: {
  participants: ParticipantSnapshot[];
  selfId: string | undefined;
  /** Режим урока — оставлен для §6.4, на форму сетки пока не влияет. */
  mode?: LessonMode;
  variant?: "grid" | "rail";
  /** «Ещё» → «Вид: сетка / докладчик» — клиентское предпочтение, только для `grid`. */
  layout?: "grid" | "speaker";
  onLayoutChange?: (layout: "grid" | "speaker") => void;
  /** Плитка «+N» в мобильной ленте — открыть список участников. */
  onShowAll?: () => void;
}) {
  const narrow = useIsNarrowViewport();
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const trackByIdentity = new Map(cameraTracks.map((t) => [t.participant.identity, t]));
  const speakingIds = new Set(useSpeakingParticipants().map((p) => p.identity));
  const roomParticipants = useParticipants();
  const micOffIds = new Set(
    roomParticipants.filter((p) => !p.isMicrophoneEnabled).map((p) => p.identity),
  );
  // Значок «плохая связь» — только персоналу: учителю полезно видеть, у кого
  // проблемы; ученику технические статусы на уроке не показываем.
  const viewerIsStaff = useRoomIdentity()?.kind === "staff";
  const weakIds = new Set(
    roomParticipants
      .filter(() => viewerIsStaff)
      .filter(
        (p) =>
          p.connectionQuality === ConnectionQuality.Poor ||
          p.connectionQuality === ConnectionQuality.Lost,
      )
      .map((p) => p.identity),
  );
  // Своя плитка рисуется по «намерению» из `SelfCameraUiStore`, а не по
  // факту трека: включение показывает лоадер вместо чёрного экрана,
  // выключение прячет видео сразу по клику.
  const selfDesiredOn = useSelfCameraUiStore((s) => s.desiredOn);
  const selfFrameReady = useSelfCameraUiStore((s) => s.frameReady);
  const setSelfFrameReady = useSelfCameraUiStore((s) => s.setFrameReady);

  const tiles = participants
    .filter((p) => p.connected)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "staff" ? -1 : 1;
      return a.joinedAt.localeCompare(b.joinedAt);
    });

  const [page, setPage] = useState(0);
  const [railExpanded, setRailExpanded] = useState(false);

  // Кого показывать крупно (телефон, «докладчик»): закреплённый → последний
  // говоривший (не сбрасывается в тишине, чтобы не прыгало) → учитель → первый.
  const lastSpeakerRef = useRef<string | null>(null);
  const speakingNow = tiles.find((p) => speakingIds.has(p.userId) && p.userId !== selfId);
  if (speakingNow) lastSpeakerRef.current = speakingNow.userId;
  const focus =
    tiles.find((p) => p.pinned) ??
    tiles.find((p) => p.userId === lastSpeakerRef.current) ??
    tiles.find((p) => p.kind === "staff" && p.userId !== selfId) ??
    tiles.find((p) => p.userId !== selfId) ??
    tiles[0];

  const desktopGrid = variant === "grid" && !narrow && !(layout === "speaker" && tiles.length > 1);
  const paged = desktopGrid && tiles.length > PAGE_SIZE;
  const perPage = PAGE_SIZE - 1;
  const pages = paged ? Math.ceil((tiles.length - PAGE_SIZE) / perPage) + 1 : 1;
  const safePage = Math.min(page, pages - 1);
  const start = paged ? safePage * perPage : 0;
  const isLastPage = !paged || tiles.length - start <= PAGE_SIZE;
  const pageTiles = paged ? tiles.slice(start, isLastPage ? undefined : start + perPage) : tiles;
  const moreCount = isLastPage ? 0 : tiles.length - start - pageTiles.length;
  const gridCells = desktopGrid ? pageTiles.length + (moreCount > 0 ? 1 : 0) : 0;

  const gridRef = useRef<HTMLDivElement>(null);
  const { cols, tile } = useAdaptiveGrid(gridRef, gridCells, GAP, 16 / 9);

  const renderTile = (p: ParticipantSnapshot, size: TileSize, className?: string) => {
    const track = trackByIdentity.get(p.userId);
    const isSelf = p.userId === selfId;
    const videoTrack = isSelf && !selfDesiredOn ? undefined : track;
    const showLoader = isSelf && selfDesiredOn && !selfFrameReady;
    const speaking = speakingIds.has(p.userId);
    const micOff = micOffIds.has(p.userId);
    const weak = weakIds.has(p.userId);
    const roleSuffix = p.kind === "staff" && p.role ? ROLE_SUFFIX[p.role] : undefined;
    const small = size === "sm" || size === "xs";

    return (
      <div
        key={p.userId}
        className={cn(
          "relative flex items-center justify-center overflow-hidden bg-slate-900",
          size === "lg" ? "rounded-2xl" : "rounded-xl",
          className,
        )}
      >
        {videoTrack ? (
          <VideoTrack
            trackRef={videoTrack}
            onLoadedData={isSelf ? () => setSelfFrameReady(true) : undefined}
            className={cn(
              "absolute inset-0 size-full object-cover transition-opacity",
              isSelf && "-scale-x-100",
              showLoader && "opacity-0",
            )}
          />
        ) : !showLoader ? (
          <span
            className={cn(
              "flex items-center justify-center rounded-full bg-white/10 font-bold text-white",
              size === "lg" && "size-14 text-lg",
              size === "md" && "size-11 text-[15px]",
              size === "sm" && "size-[34px] text-xs",
              size === "xs" && "size-[30px] text-[11px]",
            )}
          >
            {initialsOf(p.fullName)}
          </span>
        ) : null}

        {showLoader ? (
          <div role="status" className="absolute inset-0 flex items-center justify-center bg-slate-900">
            <span className="relative inline-flex items-center justify-center">
              <span
                className="absolute inset-0 animate-ping rounded-full bg-primary/40"
                style={{ animationDuration: "1.4s" }}
                aria-hidden
              />
              <span
                className={cn(
                  "relative flex items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/25",
                  small ? "size-7" : "size-10",
                )}
              >
                <Loader2 className={cn("animate-spin", small ? "size-3.5" : "size-5")} aria-hidden />
              </span>
            </span>
            <span className="sr-only">Камера загружается</span>
          </div>
        ) : null}

        {speaking ? (
          <span
            className="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-inset ring-primary"
            aria-hidden
          />
        ) : null}

        {speaking && (size === "lg" || size === "md") ? (
          <span className="pointer-events-none absolute left-2.5 top-2.5 inline-flex h-6 items-center rounded-full bg-primary px-2.5 text-xs font-semibold text-primary-foreground">
            говорит
          </span>
        ) : null}

        {p.handRaised || p.pinned ? (
          <span className={cn("absolute flex gap-1", small ? "right-1.5 top-1.5" : "right-2.5 top-2.5")}>
            {p.handRaised ? (
              <span
                className={cn(
                  "flex items-center justify-center rounded-full bg-warning text-warning-foreground",
                  small ? "size-5" : "size-[26px]",
                )}
              >
                <Hand className={small ? "size-3" : "size-3.5"} aria-label="Поднята рука" />
              </span>
            ) : null}
            {p.pinned ? (
              <span
                className={cn(
                  "flex items-center justify-center rounded-full bg-primary text-primary-foreground",
                  small ? "size-5" : "size-[26px]",
                )}
              >
                <Pin className={small ? "size-3" : "size-3.5"} aria-label="Закреплён" />
              </span>
            ) : null}
          </span>
        ) : null}

        {size !== "xs" ? (
          <span
            className={cn(
              "pointer-events-none absolute inline-flex items-center rounded-full bg-[rgba(16,24,40,.72)] font-medium text-white",
              size === "lg" && "bottom-2.5 left-2.5 h-6 max-w-[calc(100%-20px)] gap-1.5 px-[9px] text-xs",
              size === "md" && "bottom-2 left-2 h-[22px] max-w-[calc(100%-16px)] gap-[5px] px-2 text-[11.5px]",
              size === "sm" && "bottom-2 left-2 h-5 max-w-[calc(100%-16px)] gap-1 px-[7px] text-[11px]",
            )}
          >
            {micOff ? (
              <MicOff className="size-3 shrink-0 text-red-300" aria-label="Микрофон выключен" />
            ) : null}
            {weak ? <SignalLow className="size-3 shrink-0 text-amber-400" aria-label="Плохая связь" /> : null}
            <span className="truncate">
              {p.fullName}
              {isSelf ? " (вы)" : size === "lg" && roleSuffix ? ` · ${roleSuffix}` : ""}
            </span>
          </span>
        ) : null}
      </div>
    );
  };

  const strip = (list: ParticipantSnapshot[]) => {
    if (list.length === 0) return null;
    const overflow = list.length > STRIP_VISIBLE;
    const shown = overflow ? list.slice(0, STRIP_VISIBLE - 1) : list;
    return (
      <div className="flex shrink-0 gap-2 overflow-hidden">
        {shown.map((p) => renderTile(p, "xs", "aspect-[3/4] w-[84px] shrink-0"))}
        {overflow ? (
          <button
            type="button"
            onClick={onShowAll}
            aria-label="Все участники"
            className="flex aspect-[3/4] w-[84px] shrink-0 items-center justify-center rounded-xl bg-[#101828] text-base font-black text-white"
          >
            +{list.length - shown.length}
          </button>
        ) : null}
      </div>
    );
  };

  if (tiles.length === 0) return null;

  if (variant === "rail") {
    if (narrow) return strip(tiles);
    const shown = railExpanded ? tiles : tiles.slice(0, RAIL_VISIBLE);
    return (
      <div className="flex w-[190px] shrink-0 flex-col gap-2 overflow-y-auto">
        {shown.map((p) => renderTile(p, "sm", "aspect-video w-full shrink-0"))}
        {tiles.length > RAIL_VISIBLE ? (
          <button
            type="button"
            onClick={() => setRailExpanded((v) => !v)}
            className="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border bg-card text-xs font-semibold text-text-2 transition-colors hover:bg-surface-2"
          >
            {railExpanded ? "свернуть" : `ещё ${tiles.length - RAIL_VISIBLE}`}
            {railExpanded ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
          </button>
        ) : null}
      </div>
    );
  }

  if (narrow) {
    if (tiles.length === 1 || !focus) return renderTile(tiles[0]!, "lg", "size-full");
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {renderTile(focus, "lg", "min-h-0 w-full flex-1")}
        {strip(tiles.filter((p) => p.userId !== focus.userId))}
      </div>
    );
  }

  if (layout === "speaker" && tiles.length > 1 && focus) {
    return (
      <div className="flex h-full min-h-0 w-full gap-3">
        {renderTile(focus, "lg", "h-full min-w-0 flex-1")}
        <div className="flex w-[190px] shrink-0 flex-col gap-2 overflow-y-auto">
          {tiles
            .filter((p) => p.userId !== focus.userId)
            .map((p) => renderTile(p, "sm", "aspect-video w-full shrink-0"))}
        </div>
      </div>
    );
  }

  if (tiles.length === 1) return renderTile(tiles[0]!, "lg", "size-full");

  const pagerBtn =
    "flex size-[30px] shrink-0 items-center justify-center rounded-full border border-border bg-card text-text-2 transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:text-text-3 [&_svg]:size-4";

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2.5">
      {paged ? (
        <div className="flex shrink-0 items-center gap-2">
          <span className="truncate text-[13px] text-muted-foreground">
            {participantsCount(tiles.length)} · показаны {start + 1}–{start + pageTiles.length}
          </span>
          {onLayoutChange ? (
            <span className="ml-auto inline-flex shrink-0 overflow-hidden rounded-full border border-border bg-card">
              {(["grid", "speaker"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onLayoutChange(v)}
                  className={cn(
                    "h-[30px] px-3 text-[12.5px] font-semibold transition-colors",
                    layout === v ? "bg-primary text-primary-foreground" : "text-text-2 hover:bg-surface-2",
                  )}
                >
                  {v === "grid" ? "Сетка" : "Докладчик"}
                </button>
              ))}
            </span>
          ) : null}
          <button
            type="button"
            aria-label="Предыдущие участники"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
            className={cn(pagerBtn, !onLayoutChange && "ml-auto")}
          >
            <ChevronLeft aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Следующие участники"
            disabled={safePage >= pages - 1}
            onClick={() => setPage(safePage + 1)}
            className={pagerBtn}
          >
            <ChevronRight aria-hidden />
          </button>
        </div>
      ) : null}
      <div
        ref={gridRef}
        className="grid min-h-0 flex-1 place-content-center"
        style={{
          gap: GAP,
          gridTemplateColumns: tile > 0 ? `repeat(${cols}, ${tile}px)` : `repeat(${cols}, minmax(0, 1fr))`,
        }}
      >
        {pageTiles.map((p) => renderTile(p, paged ? "md" : "lg", "aspect-video w-full"))}
        {moreCount > 0 ? (
          <button
            type="button"
            onClick={() => setPage(safePage + 1)}
            className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-xl bg-[#101828] text-white"
          >
            <span className="text-[22px] font-black tracking-[-.025em]">+{moreCount}</span>
            <span className="text-xs text-white/70">ещё участников</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
