import { useEffect, useRef, useState } from "react";
import {
  useParticipants,
  useSpeakingParticipants,
  useTracks,
  VideoTrack,
} from "@livekit/components-react";
import { ConnectionQuality, Track } from "livekit-client";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Hand,
  AudioLines,
  Maximize2,
  MicOff,
  Minimize2,
  Pin,
  SignalLow,
} from "lucide-react";
import type { LessonMode, ParticipantSnapshot } from "@school/shared";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/shared/ui/avatar";
import { markRoleOf } from "@/shared/ui/role-mark";
import { ParticipantPlaceholder } from "./ParticipantPlaceholder.js";
import { MediaLoader } from "@/shared/ui/media-loader";
import { Loader } from "@/shared/ui/loader";
import { participantsCount } from "./format.js";
import { useSelfCameraUiStore } from "./self-camera-ui-store.js";
import { isStreamPaused, useStreamStateUpdates } from "./use-stream-state.js";
import { useAdaptiveGrid } from "./use-adaptive-grid.js";
import { useIsNarrowViewport } from "./use-narrow-viewport.js";

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
 *  - `variant="pip"` — только учитель, плавающим окном в правом нижнем углу
 *    родителя (`position: relative`); сворачивается в плашку «Учитель».
 *    Так камера учителя переносится, когда учебнику нужна вся ширина.
 */
export function RoomVideoGrid({
  participants,
  reconnectingIds,
  selfId,
  variant = "grid",
  layout = "grid",
  onLayoutChange,
  onShowAll,
}: {
  participants: ParticipantSnapshot[];
  /** Связь участника с уроком прервалась недавно — плитка на месте с пометкой (`usePresenceGrace`). */
  reconnectingIds?: ReadonlySet<string>;
  selfId: string | undefined;
  /** Режим урока — оставлен для §6.4, на форму сетки пока не влияет. */
  mode?: LessonMode;
  variant?: "grid" | "rail" | "pip";
  /** «Ещё» → «Вид: сетка / докладчик» — клиентское предпочтение, только для `grid`. */
  layout?: "grid" | "speaker";
  onLayoutChange?: (layout: "grid" | "speaker") => void;
  /** Плитка «+N» в мобильной ленте — открыть список участников. */
  onShowAll?: () => void;
}) {
  const narrow = useIsNarrowViewport();
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const trackByIdentity = new Map(cameraTracks.map((t) => [t.participant.identity, t]));
  // Камера включена (опубликована и не выключена), но первый кадр ещё не
  // пришёл — на плохой связи это десятки секунд. Показываем лоадер, а не
  // чёрную плитку. Кадр пришёл — `loadedCameraSids`.
  const cameraOnIds = new Set(
    useTracks([Track.Source.Camera], { onlySubscribed: false })
      .filter((t) => t.publication && !t.publication.isMuted)
      .map((t) => t.participant.identity),
  );
  useStreamStateUpdates();
  const [loadedCameraSids, setLoadedCameraSids] = useState<ReadonlySet<string>>(() => new Set());
  const markCameraLoaded = (sid: string) =>
    setLoadedCameraSids((prev) => (prev.has(sid) ? prev : new Set(prev).add(sid)));
  const speakingIds = new Set(useSpeakingParticipants().map((p) => p.identity));
  // Для подсказки «говорит» вне экрана: речь прерывается паузами, и метка без
  // удержания мигала бы на каждом вдохе.
  const heldSpeakers = useHeldIds(speakingIds, SPEAKER_HOLD_MS);
  const roomParticipants = useParticipants();
  const micOffIds = new Set(
    roomParticipants.filter((p) => !p.isMicrophoneEnabled).map((p) => p.identity),
  );
  const weakIds = new Set(
    roomParticipants
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
  const [pipOpen, setPipOpen] = useState(true);

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
  // Говорят участники, которых на этой странице не видно: подсказка в строке
  // страниц и на плитке «+N» вместо перестановки плиток — сетка не прыгает.
  const shownIds = new Set(pageTiles.map((p) => p.userId));
  const offPageSpeakers = paged ? tiles.filter((p) => heldSpeakers.has(p.userId) && !shownIds.has(p.userId)) : [];
  const pageOf = (p: ParticipantSnapshot) => Math.min(Math.floor(tiles.indexOf(p) / perPage), pages - 1);
  const firstOffPage = offPageSpeakers[0];
  const speakersAfter = offPageSpeakers.filter((p) => pageOf(p) > safePage);

  const gridRef = useRef<HTMLDivElement>(null);
  const { cols, tile } = useAdaptiveGrid(gridRef, gridCells, GAP, 16 / 9);

  const renderTile = (p: ParticipantSnapshot, size: TileSize, className?: string) => {
    const track = trackByIdentity.get(p.userId);
    const isSelf = p.userId === selfId;
    const videoTrack = isSelf && !selfDesiredOn ? undefined : track;
    const remoteSid = videoTrack?.publication?.trackSid;
    // Выключенная чужая камера остаётся подписанным треком с `isMuted` —
    // без этой проверки плитка показывала пустое видео вместо заглушки.
    const videoOn = !!videoTrack && (isSelf || cameraOnIds.has(p.userId));
    // Чужая камера: до первого кадра и пока сервер держит её на паузе
    // (входящему каналу не хватает полосы) — иначе тёмная плитка без лоадера.
    const showLoader = isSelf
      ? selfDesiredOn && !selfFrameReady
      : cameraOnIds.has(p.userId) &&
        (!remoteSid || !loadedCameraSids.has(remoteSid) || isStreamPaused(videoTrack?.publication));
    const speaking = speakingIds.has(p.userId);
    const reconnecting = reconnectingIds?.has(p.userId) ?? false;
    const micOff = micOffIds.has(p.userId);
    const weak = weakIds.has(p.userId);
    const roleSuffix = p.kind === "staff" && p.role ? ROLE_SUFFIX[p.role] : undefined;
    const small = size === "sm" || size === "xs";

    return (
      <div
        key={p.userId}
        className={cn(
          "relative flex items-center justify-center overflow-hidden bg-[#101828]",
          size === "lg" ? "rounded-2xl" : "rounded-xl",
          className,
        )}
      >
        {videoTrack ? (
          <VideoTrack
            trackRef={videoTrack}
            onLoadedData={
              isSelf ? () => setSelfFrameReady(true) : remoteSid ? () => markCameraLoaded(remoteSid) : undefined
            }
            className={cn(
              "absolute inset-0 size-full object-cover transition-opacity",
              isSelf && "-scale-x-100",
              (showLoader || !videoOn) && "opacity-0",
            )}
          />
        ) : null}
        {!videoOn && !showLoader ? <ParticipantPlaceholder participant={p} size={size} /> : null}

        {showLoader && !reconnecting ? <MediaLoader label="Камера загружается" size={small ? "sm" : "md"} /> : null}

        {reconnecting ? (
          <span
            role="status"
            className={cn(
              "pointer-events-none absolute inset-0 flex items-center justify-center bg-[rgba(16,24,40,.55)] text-white",
              small ? "text-[11px]" : "text-[13px]",
            )}
          >
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(16,24,40,.72)] px-2.5 py-1 font-medium">
              <Loader className="size-3.5" />
              {size === "xs" ? null : "Переподключение…"}
            </span>
          </span>
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
        {shown.map((p) => renderTile(p, "xs", "aspect-[3/4] min-w-0 max-w-[84px] flex-1"))}
        {overflow ? (
          <button
            type="button"
            onClick={onShowAll}
            aria-label="Все участники"
            className="flex aspect-[3/4] min-w-0 max-w-[84px] flex-1 items-center justify-center rounded-xl bg-[#101828] text-base font-black text-white"
          >
            +{list.length - shown.length}
          </button>
        ) : null}
      </div>
    );
  };

  if (tiles.length === 0) return null;

  if (variant === "pip") {
    const teacher =
      tiles.find((p) => p.kind === "staff" && p.userId !== selfId) ??
      tiles.find((p) => p.userId !== selfId);
    if (!teacher) return null;
    const label = teacher.kind === "staff" ? "Учитель" : teacher.fullName;
    return (
      <div className={cn("absolute z-20", narrow ? "bottom-2.5 right-2.5" : "bottom-3.5 right-3.5")}>
        {pipOpen ? (
          <div
            className={cn(
              "relative rounded-xl shadow-[0_0_0_2px_hsl(var(--primary)),0_12px_28px_rgba(16,24,40,.22)]",
              narrow ? "w-[120px]" : "w-[168px]",
            )}
          >
            {renderTile(teacher, narrow ? "xs" : "sm", "aspect-[16/10] w-full")}
            <button
              type="button"
              onClick={() => setPipOpen(false)}
              aria-label={`Свернуть видео: ${label}`}
              className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-[rgba(16,24,40,.6)] text-white transition-colors hover:bg-[rgba(16,24,40,.8)]"
            >
              <Minimize2 className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPipOpen(true)}
            aria-label={`Показать видео: ${label}`}
            className="flex h-11 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card py-0 pl-1.5 pr-3.5 text-[13.5px] font-semibold text-foreground shadow-[0_8px_20px_rgba(16,24,40,.14)]"
          >
            <span className="relative shrink-0">
              <UserAvatar id={teacher.userId} role={markRoleOf(teacher.kind, teacher.role)} size={32} />
              <span className="absolute -bottom-px -right-px size-2.5 rounded-full border-2 border-card bg-success" />
            </span>
            {label}
            <Maximize2 className="size-3.5 text-text-3" aria-hidden />
          </button>
        )}
      </div>
    );
  }

  if (variant === "rail") {
    if (narrow) return strip(tiles);
    const shown = railExpanded ? tiles : tiles.slice(0, RAIL_VISIBLE);
    const railHiddenSpeaker = railExpanded ? undefined : tiles.slice(RAIL_VISIBLE).find((p) => heldSpeakers.has(p.userId));
    return (
      <div className="flex w-[190px] shrink-0 flex-col gap-2 overflow-y-auto">
        {shown.map((p) => renderTile(p, "sm", "aspect-video w-full shrink-0"))}
        {tiles.length > RAIL_VISIBLE ? (
          <button
            type="button"
            onClick={() => setRailExpanded((v) => !v)}
            className={cn(
              "flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full border px-2 text-xs font-semibold transition-colors",
              railHiddenSpeaker
                ? "border-primary-muted bg-primary-light text-primary"
                : "border-border bg-card text-text-2 hover:bg-surface-2",
            )}
          >
            {railHiddenSpeaker ? <AudioLines className="size-3.5 shrink-0" aria-hidden /> : null}
            <span className="truncate">
              {railExpanded
                ? "свернуть"
                : railHiddenSpeaker
                  ? `${railHiddenSpeaker.fullName} · ещё ${tiles.length - RAIL_VISIBLE}`
                  : `ещё ${tiles.length - RAIL_VISIBLE}`}
            </span>
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
          {firstOffPage ? (
            <button
              type="button"
              onClick={() => setPage(pageOf(firstOffPage))}
              title="Показать страницу с говорящим"
              className="inline-flex h-[30px] min-w-0 shrink items-center gap-1.5 rounded-full bg-primary-light px-3 text-[12.5px] font-semibold text-primary transition-colors hover:bg-primary-light/80"
            >
              <AudioLines className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                {offPageSpeakers.length > 1 ? "Говорят: " : "Говорит: "}
                {firstOffPage.fullName}
                {offPageSpeakers.length > 1 ? ` и ещё ${offPageSpeakers.length - 1}` : ""}
              </span>
              <span className="shrink-0 font-medium text-primary/70">· стр. {pageOf(firstOffPage) + 1}</span>
            </button>
          ) : null}
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
            className={cn(
              "relative flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-xl bg-[#101828] px-2 text-white",
              speakersAfter.length > 0 && "ring-2 ring-inset ring-primary",
            )}
          >
            <span className="text-[22px] font-black tracking-[-.025em]">+{moreCount}</span>
            {speakersAfter.length > 0 ? (
              <span className="inline-flex max-w-full items-center gap-1 text-xs font-semibold text-white">
                <AudioLines className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">
                  {speakersAfter[0]!.fullName}
                  {speakersAfter.length > 1 ? ` и ещё ${speakersAfter.length - 1}` : ""}
                </span>
              </span>
            ) : (
              <span className="text-xs text-white/70">ещё участников</span>
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Столько метка «говорит» держится после паузы в речи. */
const SPEAKER_HOLD_MS = 2_000;

/**
 * Множество id, расширенное «хвостом»: id остаётся ещё `holdMs` после того,
 * как пропал из `ids`. Для подсказок о речи за пределами экрана — не мигают
 * между словами; на сами плитки (рамка «говорит») не влияет.
 */
function useHeldIds(ids: ReadonlySet<string>, holdMs: number): ReadonlySet<string> {
  const lastSeen = useRef(new Map<string, number>());
  const [, tick] = useState(0);
  const now = Date.now();
  for (const id of ids) lastSeen.current.set(id, now);
  const held = new Set<string>();
  let nextExpiry = Infinity;
  for (const [id, at] of lastSeen.current) {
    const until = at + holdMs;
    if (ids.has(id) || until > now) {
      held.add(id);
      if (!ids.has(id)) nextExpiry = Math.min(nextExpiry, until);
    } else {
      lastSeen.current.delete(id);
    }
  }
  useEffect(() => {
    if (nextExpiry === Infinity) return;
    const timer = setTimeout(() => tick((n) => n + 1), nextExpiry - Date.now() + 20);
    return () => clearTimeout(timer);
  }, [nextExpiry]);
  return held;
}
