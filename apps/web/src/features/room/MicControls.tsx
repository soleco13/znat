import { useEffect, useState } from "react";
import { useIsSpeaking, useLocalParticipant, useParticipants, useRoomContext } from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track, createLocalAudioTrack, type LocalParticipant } from "livekit-client";
import { Mic, MicOff } from "lucide-react";

import { reportMediaDeviceError } from "./media-device-errors.js";
import { RoomControlButton, type RoomControlVariant } from "./RoomControlButton.js";

/**
 * Заглушённая «прогретая» дорожка (`MicPrewarm`) публикуется в фоне. Включение
 * микрофона в эти же доли секунды не видело её публикацию и публиковало вторую
 * дорожку (урок 2026-10-20, iPhone ученицы): кнопка показывала «выключен», а
 * звук шёл по второй; после нажатия «включить» — обе, двойной голос. Поэтому
 * включение ждёт окончания прогрева, а прогрев не начинается во время включения.
 */
let prewarmInFlight: Promise<void> | null = null;
let enablingMic = false;

/** Включить/выключить свой микрофон — единственный путь для кнопки и восстановления. */
export async function setOwnMicrophone(participant: LocalParticipant, on: boolean): Promise<void> {
  enablingMic = true;
  try {
    if (prewarmInFlight) await prewarmInFlight.catch(() => undefined);
    await participant.setMicrophoneEnabled(on);
  } finally {
    enablingMic = false;
  }
}

/**
 * Кнопка «мьют себя» (Э2.5) — для любого участника с правом `canSpeak`.
 * Юзабилити-правка: без права кнопка не пропадает совсем (человек не должен
 * гадать, немой он или сломалось), а становится disabled с объяснением
 * в подсказке — `disabledReason`, обычно «поднимите руку».
 */
export function SelfMicButton({
  disabled = false,
  disabledReason,
  variant,
  onOpenSettings,
}: {
  disabled?: boolean;
  disabledReason?: string;
  variant?: RoomControlVariant;
  onOpenSettings?: () => void;
}) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const speaking = useIsSpeaking(localParticipant);
  // Кнопка — по намерению, а не по факту из LiveKit (2026-10-15: «кнопки долго
  // откликаются»): вид меняется сразу, включение доделывается в фоне;
  // не вышло — откатываемся к тому, что есть на самом деле.
  const [desired, setDesired] = useState(isMicrophoneEnabled);
  useEffect(() => {
    setDesired(isMicrophoneEnabled);
  }, [isMicrophoneEnabled]);
  return (
    <RoomControlButton
      active={desired}
      loading={desired && !isMicrophoneEnabled}
      activeIcon={Mic}
      inactiveIcon={MicOff}
      activeLabel="Микрофон"
      inactiveLabel="Включить звук"
      speaking={speaking && isMicrophoneEnabled}
      onToggle={() => {
        const next = !desired;
        setDesired(next);
        setOwnMicrophone(localParticipant, next).catch((err: unknown) => {
          setDesired(localParticipant.isMicrophoneEnabled);
          if (next) reportMediaDeviceError("microphone", err);
        });
      }}
      caption="Микрофон"
      hotkey="M"
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      variant={variant}
      onOpenSettings={onOpenSettings}
      settingsLabel="Выбрать микрофон"
    />
  );
}

/** Значок текущего состояния микрофона участника — из LiveKit-комнаты, не из presence. */
export function MicStatusIcon({ userId }: { userId: string }) {
  const participants = useParticipants();
  const match = participants.find((p) => p.identity === userId);
  if (!match || !match.isMicrophoneEnabled) return null;
  return <Mic className="size-3.5 text-success" aria-label="Микрофон включён" />;
}

/**
 * Микрофон, выключенный при входе, всё равно подключаем к уроку — сразу
 * заглушённым (как Jitsi при старте с выключенным звуком). Иначе первое
 * включение кнопкой — это захват устройства, публикация и согласование с
 * сервером: ~5 с ожидания (жалоба 2026-10-15); с готовой заглушённой
 * дорожкой включение мгновенное. Звук не уходит: дорожка заглушена до
 * публикации (`mute` до `publishTrack`). Только когда доступ к микрофону уже
 * дан и говорить разрешено — без нового запроса разрешения на уроке.
 */
export function MicPrewarm({ enabled, deviceId }: { enabled: boolean; deviceId: string | null }) {
  const room = useRoomContext();
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let busy = false;
    const hasMic = () => room.localParticipant.getTrackPublication(Track.Source.Microphone) !== undefined;
    const run = async () => {
      const track = await createLocalAudioTrack({
        ...room.options.audioCaptureDefaults,
        ...(deviceId ? { deviceId } : {}),
      });
      await track.mute();
      if (cancelled || enablingMic || hasMic()) {
        track.stop();
        return;
      }
      await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
      // Страховка: если микрофон всё же опубликовали параллельно — снимаем свою
      // заглушённую дорожку, остаётся одна.
      const mics = [...room.localParticipant.trackPublications.values()].filter(
        (p) => p.source === Track.Source.Microphone,
      );
      if (mics.length > 1) await room.localParticipant.unpublishTrack(track, true);
    };
    const prewarm = async () => {
      if (cancelled || busy || enablingMic || room.state !== ConnectionState.Connected) return;
      if (hasMic()) return;
      busy = true;
      const job = run();
      prewarmInFlight = job;
      try {
        await job;
      } catch {
        // Не вышло — первое включение кнопкой пойдёт обычным путём.
      } finally {
        busy = false;
        if (prewarmInFlight === job) prewarmInFlight = null;
      }
    };
    void prewarm();
    room.on(RoomEvent.Connected, prewarm);
    room.on(RoomEvent.Reconnected, prewarm);
    return () => {
      cancelled = true;
      room.off(RoomEvent.Connected, prewarm);
      room.off(RoomEvent.Reconnected, prewarm);
    };
  }, [enabled, deviceId, room]);
  return null;
}
