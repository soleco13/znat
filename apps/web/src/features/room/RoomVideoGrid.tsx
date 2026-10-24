import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useLocalParticipant,
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
import { MEDIA_SESSION_SEPARATOR, type LessonMode, type ParticipantSnapshot } from "@school/shared";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/shared/ui/avatar";
import { markRoleOf, participantColorKey } from "@/shared/ui/role-mark";
import { ParticipantPlaceholder } from "./ParticipantPlaceholder.js";
import { Loader } from "@/shared/ui/loader";
import { participantsCount } from "./format.js";
import { useSelfCameraUiStore } from "./self-camera-ui-store.js";
import { TILE_LOADER_MAX_MS, useTileMediaStore } from "./tile-media-store.js";
import { isStreamPaused, useStreamStateUpdates } from "./use-stream-state.js";
import { tileRects, useAdaptiveGrid, type TileRect } from "./use-adaptive-grid.js";
import { useCpuHeavy } from "./cpu-load.js";
import { deviceProfileNow } from "./device-profile.js";
import { useTileMenu } from "./tile-menu-context.js";
import { ParticipantStatsPopover } from "./ParticipantStatsPopover.js";
import { useIsNarrowViewport } from "./use-narrow-viewport.js";
import { selfTileId, withExtraSessions } from "./media-sessions.js";

const GAP = 10;
/** Базовые пропорции плитки, как у Толка: 4:3 (см. `tileInCell`). */
export const TILE_ASPECT = 4 / 3;
/**
 * Страница сетки — сколько плиток не уже этой ширины помещается в контейнер
 * (16:9), но не больше `MAX_PAGE`; на слабых машинах (≤ 4 ядер) — `WEAK_MAX_PAGE`,
 * чтобы не декодировать 25 видео разом.
 */
const MIN_TILE_W = 240;
const MAX_PAGE = 25;
const WEAK_MAX_PAGE = 16;
const PAGE_CAP =
  typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4 ? WEAK_MAX_PAGE : MAX_PAGE;
const RAIL_VISIBLE = 5;
/** Окно, в котором возврат ёмкости к прежнему значению считается колебанием. */
const CAPACITY_FLIP_MS = 1000;
const STRIP_VISIBLE = 4;

const ROLE_SUFFIX: Record<string, string> = {
  teacher: "учитель",
  admin: "администратор",
  methodist: "методист",
};

type TileSize = "lg" | "md" | "sm" | "xs";

/**
 * Плитки участников урока.
 *  - `variant="grid"` — на весь стейдж: 16:9 (дотягивается до краёв), размер и
 *    вместимость страницы подбирает `useAdaptiveGrid`; не влезли — постранично
 *    с плиткой «+N». На телефоне — говорящий во всю
 *    высоту и лента 3:4 под ним.
 *  - `variant="rail"` — узкая колонка 190px рядом с доской/демонстрацией
 *    (на телефоне — та же лента 3:4 под главным блоком).
 *  - `variant="pip"` — только учитель, плавающим окном в правом нижнем углу
 *    родителя (`position: relative`); сворачивается в плашку «Учитель».
 *    Так камера учителя переносится, когда учебнику нужна вся ширина.
 */
export function RoomVideoGrid({
  participants: lessonParticipants,
  reconnectingIds,
  selfId: selfUserId,
  variant = "grid",
  layout = "grid",
  onLayoutChange,
  onShowAll,
  ordered = false,
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
  /** Плитки в переданном порядке (окно PiP: постоянные места), без сортировки «персонал первым». */
  ordered?: boolean;
}) {
  const narrow = useIsNarrowViewport();
  const { id: lessonId } = useParams<{ id: string }>();
  // Вторая и следующие вкладки сотрудника — свои плитки (`media-sessions.ts`).
  const roomParticipants = useParticipants();
  const participants = withExtraSessions(lessonParticipants, roomParticipants);
  const selfId = selfTileId(selfUserId, useLocalParticipant().localParticipant.identity);
  const tileMenu = useTileMenu();
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
  // Кадры и «кто говорил» — в сторе, а не в состоянии сетки: сетка
  // перемонтируется при каждой смене сцены (см. `tile-media-store.ts`).
  const loadedCameraSids = useTileMediaStore((s) => s.loadedSids);
  const markCameraLoaded = useTileMediaStore((s) => s.markLoaded);
  const waitingSince = useTileMediaStore((s) => s.waitingSince);
  const noteWaiting = useTileMediaStore((s) => s.noteWaiting);
  const clearWaiting = useTileMediaStore((s) => s.clearWaiting);
  const lastSpeakerId = useTileMediaStore((s) => s.lastSpeakerId);
  const setLastSpeaker = useTileMediaStore((s) => s.setLastSpeaker);
  const speakingIds = new Set(useSpeakingParticipants().map((p) => p.identity));
  // Для подсказки «говорит» вне экрана: речь прерывается паузами, и метка без
  // удержания мигала бы на каждом вдохе.
  const heldSpeakers = useHeldIds(speakingIds, SPEAKER_HOLD_MS);
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

  const connectedTiles = participants.filter((p) => p.connected);
  const tiles = ordered
    ? connectedTiles
    : connectedTiles.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "staff" ? -1 : 1;
        return a.joinedAt.localeCompare(b.joinedAt);
      });

  const [page, setPage] = useState(0);
  const [railExpanded, setRailExpanded] = useState(false);
  const [pipOpen, setPipOpen] = useState(true);

  // Кого показывать крупно (телефон, «докладчик»): закреплённый → последний
  // говоривший (не сбрасывается в тишине, чтобы не прыгало) → учитель → первый.
  const speakingNow = tiles.find((p) => speakingIds.has(p.userId) && p.userId !== selfId);
  const speakingNowId = speakingNow?.userId;
  useEffect(() => {
    if (speakingNowId) setLastSpeaker(speakingNowId);
  }, [speakingNowId, setLastSpeaker]);
  const lastSpeaker = speakingNow?.userId ?? lastSpeakerId;
  const focus =
    tiles.find((p) => p.pinned) ??
    tiles.find((p) => p.userId === lastSpeaker) ??
    tiles.find((p) => p.kind === "staff" && p.userId !== selfId) ??
    tiles.find((p) => p.userId !== selfId) ??
    tiles[0];

  // Вместимость страницы приходит из `useAdaptiveGrid` ниже (зависит только от
  // размера контейнера) — держим последнюю измеренную.
  const [capacity, setCapacity] = useState(12);
  const desktopGrid = variant === "grid" && !narrow && !(layout === "speaker" && tiles.length > 1);
  const paged = desktopGrid && tiles.length > capacity;
  const perPage = capacity - 1;
  const pages = paged ? Math.ceil((tiles.length - capacity) / perPage) + 1 : 1;
  const safePage = Math.min(page, pages - 1);
  const isLastPage = !paged || safePage === pages - 1;
  // Последняя страница всегда полная (с перекрытием предыдущей), чтобы плитки
  // не становились огромными на «хвосте» из двух учеников.
  const start = !paged ? 0 : isLastPage ? tiles.length - capacity : safePage * perPage;
  const pageTiles = paged ? tiles.slice(start, start + (isLastPage ? capacity : perPage)) : tiles;
  const moreCount = isLastPage ? 0 : tiles.length - start - pageTiles.length;
  const gridCells = desktopGrid ? pageTiles.length + (moreCount > 0 ? 1 : 0) : 0;
  // Говорят участники, которых на этой странице не видно: подсказка в строке
  // страниц и на плитке «+N» вместо перестановки плиток — сетка не прыгает.
  const shownIds = new Set(pageTiles.map((p) => p.userId));
  const offPageSpeakers = paged ? tiles.filter((p) => heldSpeakers.has(p.userId) && !shownIds.has(p.userId)) : [];
  const pageOf = (p: ParticipantSnapshot) => Math.min(Math.floor(tiles.indexOf(p) / perPage), pages - 1);
  const firstOffPage = offPageSpeakers[0];
  const speakersAfter = offPageSpeakers.filter((p) => pageOf(p) > safePage);
  // Поднятые руки вне страницы — по очереди подъёма; учитель иначе их не видит.
  const offPageHands = paged
    ? tiles
        .filter((p) => p.handRaised && !shownIds.has(p.userId))
        .sort((a, b) => (a.handRaisedAt ?? "").localeCompare(b.handRaisedAt ?? ""))
    : [];
  const firstOffPageHand = offPageHands[0];
  const handsAfter = offPageHands.filter((p) => pageOf(p) > safePage);

  const gridRef = useRef<HTMLDivElement>(null);
  const grid = useAdaptiveGrid(gridRef, gridCells, { gap: GAP, aspect: TILE_ASPECT, minTileW: MIN_TILE_W, maxCapacity: PAGE_CAP });
  const rects = tileRects(grid, gridCells, GAP);
  // Перестройку сетки анимируем, только если устройство справляется: на
  // слабом или перегруженном ПК каждый кадр перерисовки плиток с видео
  // отнимает процессор у звука (правило проекта — адаптация без участия
  // пользователя). «Уменьшить движение» в системе выключает анимацию в CSS.
  const cpuHeavy = useCpuHeavy();
  const animateGrid = grid.animate && !cpuHeavy && !(deviceProfileNow()?.weak ?? false);
  // Ёмкость и страницы зависят друг от друга: меньше ёмкость → появляется
  // строка страниц и съедает высоту → ёмкость пересчитывается → строка
  // пропадает → ёмкость снова больше… Около 25 участников это зацикливалось
  // в layout-эффектах и урок падал (React #185, стенд T3 2026-10-17, класс на
  // 30). Возврат к значению, которое было шагом раньше, в пределах секунды —
  // это колебание: оставляем меньшую ёмкость и останавливаемся.
  const capacityHistory = useRef<{ value: number; at: number }[]>([]);
  useLayoutEffect(() => {
    if (!desktopGrid || grid.capacity === capacity) return;
    const now = performance.now();
    const history = capacityHistory.current.filter((h) => now - h.at < CAPACITY_FLIP_MS);
    const flip = history.length >= 2 && history[history.length - 2]!.value === grid.capacity;
    history.push({ value: grid.capacity, at: now });
    capacityHistory.current = history.slice(-4);
    if (flip) {
      const stable = Math.min(grid.capacity, capacity);
      if (stable !== capacity) setCapacity(stable);
      return;
    }
    setCapacity(grid.capacity);
  }, [desktopGrid, grid.capacity, capacity]);

  // Плитки, где камера включена, а кадра нет (или поток на паузе): ключи для
  // предела лоадера `TILE_LOADER_MAX_MS`. Собираются при отрисовке, в стор —
  // эффектом ниже.
  const now = Date.now();
  const mediaOf = (p: ParticipantSnapshot) => {
    const track = trackByIdentity.get(p.userId);
    const isSelf = p.userId === selfId;
    const videoTrack = isSelf && !selfDesiredOn ? undefined : track;
    const remoteSid = videoTrack?.publication?.trackSid;
    // Выключенная чужая камера остаётся подписанным треком с `isMuted` —
    // без этой проверки плитка показывала пустое видео вместо заглушки.
    const videoOn = !!videoTrack && (isSelf || cameraOnIds.has(p.userId));
    // Камера включена, но кадра нет: до первого кадра и пока сервер держит
    // поток на паузе (входящему каналу не хватает полосы).
    const waiting = isSelf
      ? selfDesiredOn && !selfFrameReady
      : cameraOnIds.has(p.userId) &&
        (!remoteSid || !loadedCameraSids.has(remoteSid) || isStreamPaused(videoTrack?.publication));
    const waitKey = isSelf ? `self:${p.userId}` : (remoteSid ?? `${p.userId}:pending`);
    return { isSelf, videoTrack, remoteSid, videoOn, waiting, waitKey };
  };
  const waitingNow = tiles.map(mediaOf).filter((m) => m.waiting).map((m) => m.waitKey);

  const renderTile = (p: ParticipantSnapshot, size: TileSize, className?: string) => {
    const { isSelf, videoTrack, remoteSid, videoOn, waiting, waitKey } = mediaOf(p);
    const since = waitingSince.get(waitKey);
    const showLoader = waiting && (since === undefined || now - since < TILE_LOADER_MAX_MS);
    const videoVisible = videoOn && !waiting;
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
          "group/tile relative flex items-center justify-center overflow-hidden bg-[#101828]",
          size === "lg" ? "rounded-2xl" : "rounded-xl",
          className,
        )}
      >
        {/* Нижний слой — всегда знак и цвет участника: пока видео нет, грузится
            или стоит на паузе, плитка не пустеет и не превращается в спиннер. */}
        <ParticipantPlaceholder participant={p} colorKey={participantColorKey(p, lessonId)} size={size} />
        {videoTrack ? (
          <TileVideo
            trackRef={videoTrack}
            onLoadedData={
              isSelf ? () => setSelfFrameReady(true) : remoteSid ? () => markCameraLoaded(remoteSid) : undefined
            }
            className={cn(
              "absolute inset-0 size-full transition-opacity duration-200 motion-reduce:transition-none",
              isSelf && "-scale-x-100",
              !videoVisible && "opacity-0",
            )}
          />
        ) : null}

        {showLoader && !reconnecting ? (
          <span
            role="status"
            className={cn(
              "pointer-events-none absolute flex items-center justify-center rounded-full bg-[rgba(16,24,40,.6)] text-white",
              "animate-in fade-in-0 fill-mode-both duration-300 [animation-delay:300ms] motion-reduce:animate-none",
              size === "xs" ? "left-1 top-1 size-5" : small ? "bottom-2 right-2 size-6" : "bottom-2.5 right-2.5 size-7",
            )}
          >
            <Loader className={size === "xs" ? "size-3" : "size-3.5"} />
            <span className="sr-only">Камера загружается</span>
          </span>
        ) : null}

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
          <ParticipantStatsPopover
            identity={p.userId}
            isSelf={isSelf}
            name={p.fullName}
            badge={isSelf ? "вы" : p.kind === "guest" ? "гость" : roleSuffix}
            colorKey={participantColorKey(p, lessonId)}
            role={markRoleOf(p.kind, p.role)}
            reconnecting={reconnecting}
            className={cn(
              "absolute inline-flex items-center rounded-full bg-[rgba(16,24,40,.72)] font-medium text-white",
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
              {isSelf ? " (вы)" : (size === "lg" || size === "md") && roleSuffix ? ` · ${roleSuffix}` : ""}
            </span>
          </ParticipantStatsPopover>
        ) : (
          // Лента телефона: короткое имя внизу плитки, иначе ученики с
          // одинаковым знаком неразличимы.
          <span className="pointer-events-none absolute inset-x-1 bottom-1 flex items-center justify-center gap-0.5 rounded-md bg-[rgba(16,24,40,.62)] px-1 text-[10px] font-medium leading-4 text-white">
            {micOff ? <MicOff className="size-2.5 shrink-0 text-red-300" aria-label="Микрофон выключен" /> : null}
            <span className="truncate">{isSelf ? "Вы" : shortName(p.fullName)}</span>
          </span>
        )}

        {tileMenu && size !== "xs" && p.userId.indexOf(MEDIA_SESSION_SEPARATOR) < 0 ? (
          <span
            className={cn(
              "absolute opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/tile:opacity-100 [@media(hover:hover)]:focus-within:opacity-100 [@media(hover:hover)]:has-[[data-state=open]]:opacity-100",
              small ? "bottom-1.5 right-1.5" : "bottom-2.5 right-2.5",
              showLoader && !reconnecting && "hidden",
            )}
          >
            {tileMenu(p)}
          </span>
        ) : null}

      </div>
    );
  };

  // Ожидания без кадра — в стор (момент начала нужен для предела лоадера);
  // закончившиеся — убрать, чтобы следующее включение камеры снова получило лоадер.
  const waitingKey = waitingNow.join("|");
  useEffect(() => {
    const current = new Set(waitingKey ? waitingKey.split("|") : []);
    const at = Date.now();
    for (const key of current) noteWaiting(key, at);
    for (const key of useTileMediaStore.getState().waitingSince.keys()) {
      if (!current.has(key)) clearWaiting(key);
    }
  }, [waitingKey, noteWaiting, clearWaiting]);
  // Перерисовать, когда истечёт предел лоадера ближайшей плитки.
  const [, bumpLoaderClock] = useState(0);
  let nextLoaderExpiry = Infinity;
  for (const key of waitingNow) {
    const since = waitingSince.get(key);
    if (since !== undefined && since + TILE_LOADER_MAX_MS > now) nextLoaderExpiry = Math.min(nextLoaderExpiry, since + TILE_LOADER_MAX_MS);
  }
  useEffect(() => {
    if (nextLoaderExpiry === Infinity) return;
    const timer = setTimeout(() => bumpLoaderClock((n) => n + 1), nextLoaderExpiry - Date.now() + 30);
    return () => clearTimeout(timer);
  }, [nextLoaderExpiry]);

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
              <UserAvatar colorKey={participantColorKey(teacher, lessonId)} role={markRoleOf(teacher.kind, teacher.role)} size={32} />
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
        {shown.map((p) => renderTile(p, "sm", "aspect-[4/3] w-full shrink-0"))}
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
    if (tiles.length === 1 || !focus) return <FitTile portraitOk>{renderTile(tiles[0]!, "lg")}</FitTile>;
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <FitTile portraitOk className="min-h-0 flex-1">
          {renderTile(focus, "lg")}
        </FitTile>
        {strip(tiles.filter((p) => p.userId !== focus.userId))}
      </div>
    );
  }

  if (layout === "speaker" && tiles.length > 1 && focus) {
    return (
      <div className="flex h-full min-h-0 w-full gap-3">
        <FitTile className="min-w-0 flex-1">{renderTile(focus, "lg")}</FitTile>
        <div className="flex w-[190px] shrink-0 flex-col gap-2 overflow-y-auto">
          {tiles
            .filter((p) => p.userId !== focus.userId)
            .map((p) => renderTile(p, "sm", "aspect-[4/3] w-full shrink-0"))}
        </div>
      </div>
    );
  }

  if (tiles.length === 1) return <FitTile>{renderTile(tiles[0]!, "lg")}</FitTile>;

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
          {firstOffPageHand ? (
            <button
              type="button"
              onClick={() => setPage(pageOf(firstOffPageHand))}
              title="Показать страницу с поднятой рукой"
              className="inline-flex h-[30px] min-w-0 shrink items-center gap-1.5 rounded-full bg-warning px-3 text-[12.5px] font-semibold text-warning-foreground transition-opacity hover:opacity-90"
            >
              <Hand className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                {firstOffPageHand.fullName}
                {offPageHands.length > 1 ? ` и ещё ${offPageHands.length - 1}` : ""}
              </span>
              <span className="shrink-0 font-medium opacity-70">· стр. {pageOf(firstOffPageHand) + 1}</span>
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
      <div ref={gridRef} className="relative min-h-0 flex-1">
        {pageTiles.map((p, i) => (
          <GridCell key={p.userId} rect={rects[i]} animate={animateGrid}>
            {renderTile(p, paged ? "md" : "lg", "size-full")}
          </GridCell>
        ))}
        {moreCount > 0 ? (
          <GridCell key="more" rect={rects[pageTiles.length]} animate={animateGrid}>
          <button
            type="button"
            onClick={() => setPage(safePage + 1)}
            className={cn(
              "relative flex size-full flex-col items-center justify-center gap-1 rounded-xl bg-[#101828] px-2 text-white",
              speakersAfter.length > 0 && "ring-2 ring-inset ring-primary",
            )}
          >
            {handsAfter.length > 0 ? (
              <span className="absolute right-2.5 top-2.5 flex size-[26px] items-center justify-center rounded-full bg-warning text-warning-foreground">
                <Hand className="size-3.5" aria-label={`Подняли руку: ${handsAfter.length}`} />
              </span>
            ) : null}
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
          </GridCell>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Одна плитка на всё место (один участник, главная плитка «докладчика» и
 * телефона) по правилу Толка (`tileInCell`): место от квадрата до 16:9 —
 * плитка занимает его целиком, иначе плитка 4:3 по центру. Раньше такие плитки
 * растягивались на всё место — в высоком окне колонна, в низком полоса (жалоба
 * 2026-10-24). `portraitOk` — на вертикальном экране телефона: от 3:4, а не от
 * квадрата. Стили — `.fit-tile` в index.css.
 */
function FitTile({ children, portraitOk, className }: { children: React.ReactNode; portraitOk?: boolean; className?: string }) {
  return (
    <div className={cn("fit-tile size-full min-h-0 min-w-0", className)} data-portrait-ok={portraitOk ? "" : undefined}>
      {children}
    </div>
  );
}

/**
 * «Вы пока один в уроке», как у Толка: камера и карточка со ссылкой — две
 * плитки одной сетки, одинакового размера и формы (`computeGrid` на 2 плитки):
 * рядом в широком окне, друг под другом в высоком.
 */
export function SoloStage({ main, card }: { main: React.ReactNode; card: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const grid = useAdaptiveGrid(ref, 2, { gap: GAP, aspect: TILE_ASPECT });
  const [a, b] = tileRects(grid, 2, GAP);
  const place = (r: TileRect | undefined) =>
    r ? { transform: `translate(${r.x}px, ${r.y}px)`, width: r.w, height: r.h } : { visibility: "hidden" as const };
  return (
    <div ref={ref} className="relative min-h-0 flex-1">
      <div className="absolute left-0 top-0" style={place(a)}>
        {main}
      </div>
      <div className="solo-side absolute left-0 top-0" style={place(b)}>
        {card}
      </div>
    </div>
  );
}

/**
 * Ячейка сетки: стоит в рассчитанной точке (`tileRects`) и при перестройке
 * плавно переезжает и меняет размер — `transform`, `width`, `height` за
 * `--motion-layout`, как плитки Толка (`grid-participant._animate`). Новая
 * ячейка проявляется (`grid-cell-enter`) чуть позже начала движения
 * остальных. Пока сетка не измерена, ячейка невидима — без мигания в углу.
 */
function GridCell({ rect, animate, children }: { rect: TileRect | undefined; animate: boolean; children: React.ReactNode }) {
  // Проявляется только ячейка, родившаяся во время анимированной перестройки
  // (кто-то вошёл). Первая отрисовка урока и листание страниц — без него.
  const [enter] = useState(animate);
  return (
    <div
      className={cn(
        "grid-cell absolute left-0 top-0",
        animate && "grid-cell-animate",
        enter && "grid-cell-enter",
        !rect && "invisible",
      )}
      style={rect ? { transform: `translate(${rect.x}px, ${rect.y}px)`, width: rect.w, height: rect.h } : undefined}
    >
      {children}
    </div>
  );
}

/**
 * Видео заполняет плитку целиком (`cover`, края кадра обрезаются), как в Толке.
 * Исключение — вертикальное видео телефона в горизонтальной плитке: если при
 * обрезке пропало бы больше этой доли кадра, показываем его целиком
 * (`contain`) поверх заглушки, иначе теряются лоб и подбородок.
 *
 * Обычную горизонтальную камеру (16:9) не вписываем никогда: плитки теперь
 * 4:3 и почти квадратные (`tileInCell`), и прежнее правило «больше 30 % —
 * вписать» оставляло у неё широкие поля сверху и снизу (жалоба 2026-10-24).
 */
const COVER_MAX_EMPTY = 0.3;

/** Видео плитки: `cover`, кроме вертикального кадра в горизонтальной плитке. */
function TileVideo({
  trackRef,
  className,
  onLoadedData,
}: {
  trackRef: React.ComponentProps<typeof VideoTrack>["trackRef"];
  className?: string;
  onLoadedData?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [contain, setContain] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { videoWidth: vw, videoHeight: vh, clientWidth: bw, clientHeight: bh } = el;
      if (!vw || !vh || !bw || !bh) return;
      const vr = vw / vh;
      const br = bw / bh;
      setContain(vr < 1 && br >= 1 && 1 - vr / br > COVER_MAX_EMPTY);
    };
    update();
    el.addEventListener("resize", update);
    el.addEventListener("loadedmetadata", update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("resize", update);
      el.removeEventListener("loadedmetadata", update);
      ro.disconnect();
    };
  }, []);
  return (
    <VideoTrack
      ref={ref}
      trackRef={trackRef}
      onLoadedData={onLoadedData}
      className={cn(className, contain ? "object-contain" : "object-cover")}
    />
  );
}

/** Имя до первого пробела — для подписи крошечной плитки ленты. */
function shortName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? fullName;
  // Вторая вкладка сотрудника — «Анна (2)», номер не теряем.
  const session = /\s(\(\d+\))$/.exec(fullName.trim());
  return session ? `${first} ${session[1]}` : first;
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
