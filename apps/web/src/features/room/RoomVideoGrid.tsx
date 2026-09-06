import { useRef } from "react";
import {
  useParticipants,
  useSpeakingParticipants,
  useTracks,
  VideoTrack,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Hand, MicOff, Pin } from "lucide-react";
import type { LessonMode, ParticipantSnapshot } from "@school/shared";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/shared/ui/avatar";
import { useAdaptiveGrid } from "./use-adaptive-grid.js";

const GAP = 8;

/**
 * Э12.7 §6.2 — единая адаптивная сетка плиток участников (учитель + ученики),
 * как в Zoom/Телемост/КонтурТолк: все плитки квадратные и одинаковые, при
 * росте числа участников уменьшаются пропорционально (`useAdaptiveGrid`).
 * Камера включена → видео `object-cover`; выключена → аватар с инициалами.
 * Активный говорящий — синяя рамка. Подписку на треки по-прежнему решает
 * `VideoSubscriptionManager` — сетка только рендерит доступное.
 *
 * `variant="filmstrip"` — горизонтальная лента (когда на стейдже доска или
 * демонстрация, §6.2): те же плитки, но скроллом в одну строку.
 */
export function RoomVideoGrid({
  participants,
  selfId,
  variant = "grid",
}: {
  participants: ParticipantSnapshot[];
  selfId: string | undefined;
  /** Режим урока — сейчас на форму сетки не влияет, оставлен для §6.4. */
  mode?: LessonMode;
  variant?: "grid" | "filmstrip";
}) {
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const trackByIdentity = new Map(cameraTracks.map((t) => [t.participant.identity, t]));
  const speakingIds = new Set(useSpeakingParticipants().map((p) => p.identity));

  const tiles = participants
    .filter((p) => p.connected)
    .sort((a, b) => {
      // учитель/персонал — первым, дальше по времени входа
      if (a.kind !== b.kind) return a.kind === "staff" ? -1 : 1;
      return a.joinedAt.localeCompare(b.joinedAt);
    });

  const gridRef = useRef<HTMLDivElement>(null);
  const { cols, tile } = useAdaptiveGrid(gridRef, variant === "grid" ? tiles.length : 0, GAP);

  if (tiles.length === 0) return null;

  const tileNodes = tiles.map((p) => {
    const track = trackByIdentity.get(p.userId);
    return (
      <div
        key={p.userId}
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-xl border bg-slate-900 ring-2 transition-[box-shadow,border-color]",
          variant === "grid" ? "aspect-square w-full" : "aspect-square h-full shrink-0",
          speakingIds.has(p.userId)
            ? "border-primary ring-primary/60"
            : "border-border ring-transparent",
        )}
      >
        {track ? (
          <VideoTrack
            trackRef={track}
            className={cn(
              "absolute inset-0 size-full object-cover",
              p.userId === selfId && "-scale-x-100",
            )}
          />
        ) : (
          <UserAvatar name={p.fullName} size={variant === "grid" ? 64 : 40} />
        )}

        <div className="absolute right-2 top-2 flex gap-1">
          {p.handRaised ? (
            <span className="flex size-6 items-center justify-center rounded-md bg-warning text-warning-foreground">
              <Hand className="size-3.5" aria-label="Поднята рука" />
            </span>
          ) : null}
          {p.pinned ? (
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Pin className="size-3.5" aria-label="Закреплён" />
            </span>
          ) : null}
        </div>

        <span className="absolute inset-x-2 bottom-2 flex items-center gap-1.5">
          <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white backdrop-blur">
            <MicStatus identity={p.userId} />
            <span className="truncate">
              {p.fullName}
              {p.userId === selfId ? " (вы)" : ""}
            </span>
          </span>
        </span>
      </div>
    );
  });

  if (variant === "filmstrip") {
    return (
      <div className="flex h-24 shrink-0 gap-2 overflow-x-auto pb-1 sm:h-28">{tileNodes}</div>
    );
  }

  return (
    <div
      ref={gridRef}
      className="grid h-[clamp(240px,52vh,560px)] w-full place-content-center content-center justify-center"
      style={{
        gap: GAP,
        gridTemplateColumns: tile > 0 ? `repeat(${cols}, ${tile}px)` : `repeat(${cols}, 1fr)`,
      }}
    >
      {tileNodes}
    </div>
  );
}

/** Иконка «микрофон выключен» из состояния LiveKit-комнаты (не из presence). */
function MicStatus({ identity }: { identity: string }) {
  const participants = useParticipants();
  const p = participants.find((x) => x.identity === identity);
  if (!p || p.isMicrophoneEnabled) return null;
  return <MicOff className="size-3 shrink-0 text-white/70" aria-label="Микрофон выключен" />;
}
