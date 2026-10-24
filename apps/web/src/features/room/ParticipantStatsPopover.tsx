import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/shared/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import type { MarkRole } from "@/shared/ui/role-mark";
import { capByServer, useParticipantStats, useParticipantStatus, type ParticipantStats } from "./participant-stats.js";

/** Потери выше — плохо слышно и видно; задержка выше — заметна в разговоре. */
const BAD_LOSS_PCT = 5;
const BAD_RTT_MS = 300;

const STATUS_TEXT = {
  active: "в уроке",
  reconnecting: "переподключается",
  lost: "нет связи",
  absent: "не подключён к видео",
} as const;

/**
 * Имя на плитке — кнопка: по клику окно со связью участника, как в Контур
 * Толке (качество, битрейт и потери в обе стороны, RTT, что отправляет).
 * Видят все участники урока (решение владельца 2026-10-24). Цифры идут, пока
 * окно открыто (`participant-stats.ts`).
 */
export function ParticipantStatsPopover({
  identity,
  isSelf,
  name,
  badge,
  colorKey,
  role,
  reconnecting,
  className,
  children,
}: {
  /** `userId` участника урока (он же LiveKit identity первого входа). */
  identity: string;
  isSelf: boolean;
  name: string;
  /** «гость», «учитель»… рядом с именем в шапке окна. */
  badge?: string;
  colorKey: string;
  role: MarkRole;
  reconnecting: boolean;
  /** Классы кнопки-имени (та же «пилюля», что была на плитке). */
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Связь участника: ${name}`}
          className={cn(
            // Пилюля 20–24 px — область клика шире видимой (WCAG 2.5.8).
            "pointer-events-auto relative cursor-pointer transition-colors before:absolute before:-inset-x-1 before:-inset-y-2 before:content-[''] hover:bg-[rgba(16,24,40,.88)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
            className,
          )}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="w-[320px] p-0">
        {open ? (
          <StatsCard identity={identity} isSelf={isSelf} name={name} badge={badge} colorKey={colorKey} role={role} reconnecting={reconnecting} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function StatsCard({
  identity,
  isSelf,
  name,
  badge,
  colorKey,
  role,
  reconnecting,
}: {
  identity: string;
  isSelf: boolean;
  name: string;
  badge?: string;
  colorKey: string;
  role: MarkRole;
  reconnecting: boolean;
}) {
  const state = useParticipantStats(identity, isSelf, true);
  const { status, quality } = useParticipantStatus(identity, true, reconnecting);
  const s: ParticipantStats | null = state.kind === "ready" ? state.stats : null;
  const score = s ? capByServer(s.score, quality) : null;
  // Большие потери на приёме при своей хорошей связи — это потери собеседника,
  // пришедшие вместе с его потоком (см. qualityScore).
  const inherited = !!s && score !== null && score >= 70 && (s.downLossPct ?? 0) > BAD_LOSS_PCT;
  const dash = state.kind === "unavailable" ? "нет данных" : "…";

  return (
    <div className="text-sm">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <UserAvatar colorKey={colorKey} role={role} size={36} />
        <div className="min-w-0">
          <div className="truncate font-semibold text-foreground">{name}</div>
          {badge ? <div className="text-xs text-muted-foreground">{badge}</div> : null}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-4 py-3 tabular-nums">
        <Row label="Качество связи">
          {score !== null ? <span className={cn("font-semibold", scoreTone(score))}>{score} / 100</span> : dash}
        </Row>
        <Row label="Статус">{STATUS_TEXT[status]}</Row>
        <Row label="Отправляет видео">{s ? (s.sendHeight ? `${s.sendHeight}p` : "нет") : dash}</Row>
        <Row label="Кодеки">{s ? `${s.audioCodec ?? "–"} / ${s.videoCodec ?? "–"}` : dash}</Row>
        <Row label="Битрейт">
          {s ? (
            <Pair up={fmtKbps(s.sendKbps)} down={fmtKbps(s.recvKbps)} />
          ) : (
            dash
          )}
        </Row>
        <Row label="Потери">
          {s ? (
            <Pair
              up={fmtPct(s.upLossPct)}
              down={fmtPct(s.downLossPct)}
              upBad={(s.upLossPct ?? 0) > BAD_LOSS_PCT}
              downBad={!inherited && (s.downLossPct ?? 0) > BAD_LOSS_PCT}
            />
          ) : (
            dash
          )}
        </Row>
        <Row label="Задержка">
          {s ? (
            <span className={cn((s.rttMs ?? 0) > BAD_RTT_MS && "font-semibold text-destructive")}>
              {s.rttMs === null ? "–" : `${s.rttMs} мс`}
            </span>
          ) : (
            dash
          )}
        </Row>
      </dl>
      {state.kind === "unavailable" ? (
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          Участник не присылает данные: у него старая версия страницы или пропала связь.
        </p>
      ) : (
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">↑ отправляет · ↓ получает</p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="whitespace-nowrap text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{children}</dd>
    </>
  );
}

function Pair({ up, down, upBad, downBad }: { up: string; down: string; upBad?: boolean; downBad?: boolean }) {
  return (
    <span className="inline-flex flex-wrap justify-end gap-x-2.5">
      <span className={cn("whitespace-nowrap", upBad && "font-semibold text-destructive")}>
        <span aria-label="отправляет" className="text-muted-foreground">↑</span> {up}
      </span>
      <span className={cn("whitespace-nowrap", downBad && "font-semibold text-destructive")}>
        <span aria-label="получает" className="text-muted-foreground">↓</span> {down}
      </span>
    </span>
  );
}

/** Тёмные оттенки: светлые success/warning проекта на белом не проходят контраст 4.5:1. */
function scoreTone(score: number): string {
  if (score >= 70) return "text-green-700";
  if (score >= 40) return "text-amber-700";
  return "text-destructive";
}

const fmtKbps = (v: number | null) => (v === null ? "–" : `${v} кбит/с`);
const fmtPct = (v: number | null) => (v === null ? "–" : `${v.toLocaleString("ru-RU")} %`);
