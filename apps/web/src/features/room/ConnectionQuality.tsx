import { useEffect, useState } from "react";
import { useLocalParticipant, useParticipants } from "@livekit/components-react";
import { ConnectionQuality, Track } from "livekit-client";
import { AlertTriangle, Signal, SignalHigh, SignalLow, SignalZero } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** Тот же порог потери пакетов, что и в мониторинге. */
const PACKET_LOSS_WARNING_RATIO = 0.03;
/** Пауза между опросами `getSenderStats()`, произвольная — не завязана на
 * внутренний `monitorFrequency` LiveKit (2000мс), т.к. тот приватный и не
 * экспортируется из пакета. */
const POLL_MS = 2000;

/** Как в Толке/Zoom — значок «палочек», не голая точка (см. также
 *  `QUALITY_LABEL` ниже: цвет один на двух уровнях, значок — тоже). */
export const QUALITY_ICON: Record<ConnectionQuality, LucideIcon> = {
  [ConnectionQuality.Excellent]: SignalHigh,
  [ConnectionQuality.Good]: SignalHigh,
  [ConnectionQuality.Poor]: SignalLow,
  [ConnectionQuality.Lost]: SignalZero,
  [ConnectionQuality.Unknown]: Signal,
};

export const QUALITY_COLOR: Record<ConnectionQuality, string> = {
  [ConnectionQuality.Excellent]: "text-success",
  [ConnectionQuality.Good]: "text-success",
  [ConnectionQuality.Poor]: "text-warning",
  [ConnectionQuality.Lost]: "text-destructive",
  [ConnectionQuality.Unknown]: "text-text-3",
};

export const QUALITY_LABEL: Record<ConnectionQuality, string> = {
  [ConnectionQuality.Excellent]: "связь отличная",
  [ConnectionQuality.Good]: "связь хорошая",
  [ConnectionQuality.Poor]: "плохая связь",
  [ConnectionQuality.Lost]: "связь потеряна",
  [ConnectionQuality.Unknown]: "качество связи неизвестно",
};

/**
 * Индикатор качества связи участника (Э2.8, доп. — значок вместо точки, как
 * в Толке) — читает `connectionQuality` прямо со свойства найденного
 * `Participant`, тем же безопасным паттерном, что и
 * `ParticipantPresenceDot`/`MicStatusIcon` (не хук `useConnectionQualityIndicator()`:
 * внутри он через `useEnsureParticipant()` бросает исключение, если участник ещё не
 * появился в LiveKit-комнате — та же гонка, что описана в Э2.6 для `useIsSpeaking()`,
 * проверено чтением исходника `useConnectionQualityIndicator.ts` в node_modules).
 * Значение приходит от сервера LiveKit по всем участникам одинаково (`RoomEvent.ConnectionQualityChanged`
 * входит в набор событий, на которые по умолчанию перерисовывается `useParticipants()` —
 * проверено чтением `allRemoteParticipantRoomEvents` в `@livekit/components-core`), поэтому
 * не требует собственного опроса `getStats()`.
 *
 * `aria-label` прямо на иконке (не `title`) — тот же приём, что у `Hand`/`Pin`
 * в `RoomVideoGrid`: на тач-экране `title` не всплывает, а так смысл виден
 * скринридеру независимо от способа ввода.
 */
export function ConnectionQualityIcon({ userId, className }: { userId: string; className?: string }) {
  const participants = useParticipants();
  const match = participants.find((p) => p.identity === userId);
  const quality = match?.connectionQuality ?? ConnectionQuality.Unknown;
  const Icon = QUALITY_ICON[quality];
  return (
    <Icon
      aria-label={QUALITY_LABEL[quality]}
      className={`size-3.5 shrink-0 ${QUALITY_COLOR[quality]} ${className ?? ""}`}
    />
  );
}

/**
 * Предупреждение о потере пакетов > 3% (Э2.8, §10.10 ТЗ) — только для
 * собственного микрофона текущего пользователя.
 *
 * Сознательно не считается для остальных участников: `getReceiverStats()` на
 * подписанном треке отражает потери на ПУТИ SFU → я, то есть качество МОЕГО
 * входящего канала, а не исходящего канала того участника — у разных
 * слушателей в одной комнате число для одного и того же говорящего было бы
 * разным и вводило бы в заблуждение (проверено чтением `RemoteAudioTrack.getReceiverStats()`:
 * это статистика `inbound-rtp` собственного `RTCRtpReceiver`). Для локального
 * микрофона `getSenderStats()` даёт `outbound-rtp` того единственного
 * соединения с SFU, которое едино для всех — это и есть моя действительная
 * потеря пакетов на отправке.
 *
 * `TrackPublication.getStats()` не существует в установленной версии
 * `livekit-client` (2.22.0) — вопреки примерам в официальной документации,
 * метод синхронно недоступен ни на публикации, ни как кэш; реальный метод
 * асинхронный и лежит на самом треке: `LocalAudioTrack.getSenderStats()`
 * (проверено чтением исходника, не по документации).
 */
export function PacketLossWarning() {
  const { localParticipant } = useLocalParticipant();
  const [lossRatio, setLossRatio] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const track = localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
      const stats = await track?.getSenderStats();
      if (cancelled || !stats) return;
      const { packetsSent = 0, packetsLost = 0 } = stats;
      const total = packetsSent + packetsLost;
      // Малая выборка сразу после подключения даёт шумное, не показательное
      // отношение — ждём, пока накопится хотя бы полсотни пакетов.
      setLossRatio(total >= 50 ? packetsLost / total : null);
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [localParticipant]);

  if (lossRatio === null || lossRatio <= PACKET_LOSS_WARNING_RATIO) return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning">
      <AlertTriangle className="size-3.5" aria-hidden />
      плохая связь (потери пакетов {Math.round(lossRatio * 100)}%)
    </span>
  );
}
