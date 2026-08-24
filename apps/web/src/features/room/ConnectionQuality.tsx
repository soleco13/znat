import { useEffect, useState } from "react";
import { useLocalParticipant, useParticipants } from "@livekit/components-react";
import { ConnectionQuality, Track } from "livekit-client";

/** §10.10 ТЗ / docs/ПЛАН.md Э2.8 — тот же порог, что в мониторинге Grafana. */
const PACKET_LOSS_WARNING_RATIO = 0.03;
/** Пауза между опросами `getSenderStats()`, произвольная — не завязана на
 * внутренний `monitorFrequency` LiveKit (2000мс), т.к. тот приватный и не
 * экспортируется из пакета. */
const POLL_MS = 2000;

const QUALITY_COLOR: Record<ConnectionQuality, string> = {
  [ConnectionQuality.Excellent]: "bg-green-500",
  [ConnectionQuality.Good]: "bg-green-500",
  [ConnectionQuality.Poor]: "bg-amber-500",
  [ConnectionQuality.Lost]: "bg-red-500",
  [ConnectionQuality.Unknown]: "bg-slate-300",
};

const QUALITY_LABEL: Record<ConnectionQuality, string> = {
  [ConnectionQuality.Excellent]: "связь отличная",
  [ConnectionQuality.Good]: "связь хорошая",
  [ConnectionQuality.Poor]: "плохая связь",
  [ConnectionQuality.Lost]: "связь потеряна",
  [ConnectionQuality.Unknown]: "качество связи неизвестно",
};

/**
 * Индикатор качества связи участника (Э2.8) — читает `connectionQuality`
 * прямо со свойства найденного `Participant`, тем же безопасным паттерном,
 * что и `ParticipantPresenceDot`/`MicStatusIcon` (не хук `useConnectionQualityIndicator()`:
 * внутри он через `useEnsureParticipant()` бросает исключение, если участник ещё не
 * появился в LiveKit-комнате — та же гонка, что описана в Э2.6 для `useIsSpeaking()`,
 * проверено чтением исходника `useConnectionQualityIndicator.ts` в node_modules).
 * Значение приходит от сервера LiveKit по всем участникам одинаково (`RoomEvent.ConnectionQualityChanged`
 * входит в набор событий, на которые по умолчанию перерисовывается `useParticipants()` —
 * проверено чтением `allRemoteParticipantRoomEvents` в `@livekit/components-core`), поэтому
 * не требует собственного опроса `getStats()`.
 */
export function ConnectionQualityDot({ userId }: { userId: string }) {
  const participants = useParticipants();
  const match = participants.find((p) => p.identity === userId);
  const quality = match?.connectionQuality ?? ConnectionQuality.Unknown;
  return (
    <span
      title={QUALITY_LABEL[quality]}
      className={`h-2 w-2 rounded-full ${QUALITY_COLOR[quality]}`}
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
    <span className="text-xs text-amber-600">
      ⚠️ плохая связь (потери пакетов {Math.round(lossRatio * 100)}%)
    </span>
  );
}
