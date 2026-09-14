import { useRef, useState } from "react";
import {
  useParticipants,
  useSpeakingParticipants,
  useTracks,
  VideoTrack,
} from "@livekit/components-react";
import { ConnectionQuality, Track } from "livekit-client";
import { ChevronDown, ChevronUp, Hand, Loader2, MicOff, Pin } from "lucide-react";
import type { LessonMode, ParticipantSnapshot } from "@school/shared";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/shared/ui/avatar";
import { Button } from "@/shared/ui/button";
import { QUALITY_COLOR, QUALITY_ICON, QUALITY_LABEL } from "./ConnectionQuality.js";
import { useSelfCameraUiStore } from "./self-camera-ui-store.js";
import { useAdaptiveGrid } from "./use-adaptive-grid.js";

const GAP = 8;
/** Сколько плиток видно в боковой ленте до перелистывания (§6.2 «3 камеры в ряд»). */
const RAIL_PAGE = 3;

type Variant = "grid" | "rail";

/**
 * Э12.7 §6.2 — плитки участников (учитель + ученики), как в
 * Zoom/Телемост/КонтурТолк: все квадратные и одинаковые.
 *
 *  - `variant="grid"` — на весь стейдж, число колонок и размер плитки
 *    подбирает `useAdaptiveGrid` (при росте числа участников — мельче).
 *  - `variant="rail"` — узкая колонка справа от доски/демонстрации/материала:
 *    видно `RAIL_PAGE` плиток, остальные — по кнопкам ▲/▼.
 *
 * Камера включена → видео `object-cover`; выключена → аватар. Активный
 * говорящий — синяя рамка. Подписку на треки решает `VideoSubscriptionManager`.
 */
export function RoomVideoGrid({
  participants,
  selfId,
  variant = "grid",
}: {
  participants: ParticipantSnapshot[];
  selfId: string | undefined;
  /** Режим урока — оставлен для §6.4, на форму сетки пока не влияет. */
  mode?: LessonMode;
  variant?: Variant;
}) {
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const trackByIdentity = new Map(cameraTracks.map((t) => [t.participant.identity, t]));
  const speakingIds = new Set(useSpeakingParticipants().map((p) => p.identity));
  const roomParticipants = useParticipants();
  const micOffIds = new Set(
    roomParticipants.filter((p) => !p.isMicrophoneEnabled).map((p) => p.identity),
  );
  // Как в Толке — значок качества связи прямо на плитке, не только в
  // списке участников (см. `ConnectionQualityIcon` — тот же источник
  // данных, но там свой `useParticipants()` на строку; здесь участники уже
  // получены один раз выше, повторный хук на каждую плитку не нужен).
  const qualityByIdentity = new Map(
    roomParticipants.map((p) => [p.identity, p.connectionQuality]),
  );
  // Своя плитка рисуется по «намерению» из `SelfCameraUiStore`, а не по
  // факту трека — см. комментарий там же: включение показывает лоадер
  // вместо чёрного экрана, выключение прячет видео сразу по клику кнопки,
  // не дожидаясь остановки трека под капотом.
  const selfDesiredOn = useSelfCameraUiStore((s) => s.desiredOn);
  const selfFrameReady = useSelfCameraUiStore((s) => s.frameReady);
  const setSelfFrameReady = useSelfCameraUiStore((s) => s.setFrameReady);

  const tiles = participants
    .filter((p) => p.connected)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "staff" ? -1 : 1;
      return a.joinedAt.localeCompare(b.joinedAt);
    });

  const gridRef = useRef<HTMLDivElement>(null);
  const { cols, tile } = useAdaptiveGrid(gridRef, variant === "grid" ? tiles.length : 0, GAP);
  const [page, setPage] = useState(0);

  const renderTile = (p: ParticipantSnapshot) => {
    const track = trackByIdentity.get(p.userId);
    const isSelf = p.userId === selfId;
    // Для чужих плиток — как раньше, по факту наличия трека. Для своей —
    // по `selfDesiredOn`: клик «выключить» прячет видео сразу, не дожидаясь
    // реальной остановки трека; клик «включить» до первого кадра показывает
    // лоадер, а не чёрный `<video>`.
    const videoTrack = isSelf && !selfDesiredOn ? undefined : track;
    const showLoader = isSelf && selfDesiredOn && !selfFrameReady;
    return (
      <div
        key={p.userId}
        className={cn(
          "relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border bg-slate-900 ring-2 transition-[box-shadow,border-color]",
          speakingIds.has(p.userId)
            ? "border-primary ring-primary/60"
            : "border-border ring-transparent",
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
          <UserAvatar name={p.fullName} size={variant === "rail" ? 36 : 64} />
        ) : null}

        {showLoader ? (
          <div
            role="status"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900"
          >
            <span className="relative inline-flex items-center justify-center">
              <span
                className="absolute inset-0 animate-ping rounded-full bg-primary/40"
                style={{ animationDuration: "1.4s" }}
                aria-hidden
              />
              <span
                className={cn(
                  "relative flex items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/25",
                  variant === "rail" ? "size-6 sm:size-7" : "size-7 sm:size-10",
                )}
              >
                <Loader2
                  className={cn("animate-spin", variant === "rail" ? "size-3 sm:size-3.5" : "size-3.5 sm:size-5")}
                  aria-hidden
                />
              </span>
            </span>
            {variant !== "rail" ? (
              <span className="max-w-full truncate px-1.5 text-center text-[10px] font-medium leading-none text-white/70 sm:text-[11px]">
                Камера загружается…
              </span>
            ) : null}
            <span className="sr-only">Камера загружается</span>
          </div>
        ) : null}

        {(p.handRaised || p.pinned) && (
          <div className="absolute right-1.5 top-1.5 flex gap-1">
            {p.handRaised ? (
              <span className="flex size-5 items-center justify-center rounded-md bg-warning text-warning-foreground">
                <Hand className="size-3" aria-label="Поднята рука" />
              </span>
            ) : null}
            {p.pinned ? (
              <span className="flex size-5 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Pin className="size-3" aria-label="Закреплён" />
              </span>
            ) : null}
          </div>
        )}

        <span className="absolute inset-x-1.5 bottom-1.5 flex">
          <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur">
            {(() => {
              const quality = qualityByIdentity.get(p.userId) ?? ConnectionQuality.Unknown;
              const QualityIcon = QUALITY_ICON[quality];
              return (
                <QualityIcon
                  aria-label={QUALITY_LABEL[quality]}
                  className={cn("size-3 shrink-0", QUALITY_COLOR[quality])}
                />
              );
            })()}
            {micOffIds.has(p.userId) ? (
              <MicOff className="size-3 shrink-0 text-white/70" aria-label="Микрофон выключен" />
            ) : null}
            <span className="truncate">
              {p.fullName}
              {isSelf ? " (вы)" : ""}
            </span>
          </span>
        </span>
      </div>
    );
  };

  if (tiles.length === 0) return null;

  if (variant === "rail") {
    const pages = Math.ceil(tiles.length / RAIL_PAGE);
    const safePage = Math.min(page, pages - 1);
    const shown = tiles.slice(safePage * RAIL_PAGE, safePage * RAIL_PAGE + RAIL_PAGE);
    return (
      <>
        {/* На мобиле рядом с доской/демонстрацией/заданием родитель
            (`StageContent`) складывает главный блок и ленту в колонку
            (`flex-col sm:flex-row`) — фиксированная ширина `w-32` там дала
            бы узкую колонку тайлов посреди экрана. Вместо этого — лента
            горизонтальная, во всю ширину, без пейджинга (нативный скролл
            вместо кнопок ▲/▼, которым здесь просто нет удобного места). */}
        <div className="flex w-full shrink-0 gap-2 overflow-x-auto pb-0.5 sm:hidden">
          {tiles.map((p) => (
            <div key={p.userId} className="w-20 shrink-0">
              {renderTile(p)}
            </div>
          ))}
        </div>
        <div className="hidden w-32 shrink-0 flex-col gap-2 sm:flex sm:w-40 lg:w-44">
          {tiles.length > RAIL_PAGE ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full"
              onClick={() => setPage((n) => Math.max(0, n - 1))}
              disabled={safePage === 0}
              aria-label="Предыдущие участники"
            >
              <ChevronUp aria-hidden />
            </Button>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col gap-2">{shown.map(renderTile)}</div>
          {tiles.length > RAIL_PAGE ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1"
                onClick={() => setPage((n) => Math.min(pages - 1, n + 1))}
                disabled={safePage >= pages - 1}
                aria-label="Следующие участники"
              >
                <ChevronDown aria-hidden />
              </Button>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {safePage + 1}/{pages}
              </span>
            </div>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <div
      ref={gridRef}
      className="grid h-full min-h-[200px] w-full place-content-center content-center justify-center"
      style={{
        gap: GAP,
        gridTemplateColumns: tile > 0 ? `repeat(${cols}, ${tile}px)` : `repeat(${cols}, 1fr)`,
      }}
    >
      {tiles.map(renderTile)}
    </div>
  );
}
