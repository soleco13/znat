import { useEffect, useRef } from "react";
import { useRoomContext } from "@livekit/components-react";
import {
  ConnectionState,
  DisconnectReason,
  RoomEvent,
  type LocalParticipant,
  type ReconnectPolicy,
  type RoomConnectOptions,
} from "livekit-client";
import type { JoinLessonResponse } from "@school/shared";

import { apiFetch } from "@/shared/api-client";
import { reportMediaDeviceError } from "./media-device-errors.js";
import { reportLiveKitConnectionFailed } from "./MediaTelemetry.js";

/**
 * Медиа на плохой связи. Штатно LiveKit ждёт подключения 15 с с одним
 * повтором и переподключается ~45 с, а новое TCP+TLS-соединение на мобильной
 * сети с потерями само идёт 10–20 с. Даём больше времени и попыток.
 */
const RECONNECT_WINDOW_MS = 5 * 60_000;
const RECONNECT_MAX_DELAY_MS = 7000;
export const MEDIA_RECONNECT_POLICY: ReconnectPolicy = {
  nextRetryDelayInMs: ({ retryCount, elapsedMs }) =>
    elapsedMs > RECONNECT_WINDOW_MS ? null : Math.min(300 * 2 ** retryCount, RECONNECT_MAX_DELAY_MS),
};
export const MEDIA_CONNECT_OPTIONS: RoomConnectOptions = {
  // Э6.2, §5.2 ТЗ: автоподписка выключена намеренно — подпиской управляет
  // `VideoSubscriptionManager`, единственное место.
  autoSubscribe: false,
  maxRetries: 3,
  websocketTimeout: 30_000,
  peerConnectionTimeout: 30_000,
};

/**
 * Причины отключения, после которых заново подключаться НЕ надо — это не сеть.
 * `ROOM_DELETED`/`ROOM_CLOSED` сюда не входят: урок постоянный (Э12.9), и
 * если медиакомнату закрыли под живым участником (рестарт LiveKit, зачистка
 * пустой комнаты), правильный выход — войти заново; раньше видео и звук
 * просто пропадали без объяснения. Удаление из урока останавливает
 * восстановление через `onBlocked` (403 на /join).
 */
const FINAL_DISCONNECT_REASONS = new Set<DisconnectReason>([
  DisconnectReason.CLIENT_INITIATED,
  DisconnectReason.DUPLICATE_IDENTITY,
  DisconnectReason.PARTICIPANT_REMOVED,
]);
const CHECK_MS = 5000;
const RETRY_MAX_MS = 30_000;
/**
 * «Зомби»: LiveKit сдался (движок закрыт), но запоздавшая попытка рестарта
 * успела перевести комнату в `Reconnecting` — и так она остаётся навсегда:
 * `Disconnected` больше не наступит, медиа нет даже на хорошей сети
 * (livekit-client 2.22.0, E2E 2026-10-04 AFTER, HORRIBLE 6 мин). Столько
 * ждём, прежде чем отключить такую комнату и войти заново.
 */
const ZOMBIE_AFTER_MS = 10_000;
/** Страховка без опоры на внутренности движка: не подключены дольше окна переподключения LiveKit. */
const STUCK_AFTER_MS = RECONNECT_WINDOW_MS + 60_000;
/**
 * После (пере)подключения публикации возвращаются не мгновенно. Пока идёт
 * это окно, текущее «ничего не опубликовано» — не выбор человека, и
 * запоминать его нельзя: иначе намерение «камера и микрофон включены»
 * терялось навсегда (E2E-тест 2026-10-04).
 */
const SETTLE_MS = 15_000;
/** Когда проверить, что включённое вернулось. */
const ENSURE_AFTER_MS = [3000, 9000];

export interface WantedMedia {
  camera: boolean;
  microphone: boolean;
}

/**
 * Если LiveKit так и не подключился или исчерпал переподключения —
 * подключаем ТУ ЖЕ комнату заново со свежим пропуском (/join) и возвращаем
 * камеру и микрофон, если они были включены.
 *
 * Прежняя версия (2026-09-26) пересоздавала `LiveKitRoom` на любую ошибку,
 * в том числе пока LiveKit сам восстанавливал соединение: сервер выкидывал
 * старую сессию (`DUPLICATE_IDENTITY`), а новая поднималась без камеры и
 * микрофона — у ученика пропадали видео и звук. Теперь: только когда
 * комната действительно в состоянии `Disconnected`, и без второй комнаты.
 */
export function MediaRecovery({
  lessonId,
  restoreCamera,
  onRejoined,
  onBlocked,
  onTakenOver,
  resumeSignal,
  initialWanted,
  onWantedChange,
}: {
  lessonId: string;
  restoreCamera: (participant: LocalParticipant) => Promise<unknown>;
  onRejoined: (data: JoinLessonResponse) => void;
  /** Ошибка /join, после которой пробовать бессмысленно (удалён, урок закрыт). `true` — перестать. */
  onBlocked: (err: unknown) => boolean;
  /** Тот же человек вошёл в урок с другой вкладки/устройства — медиа здесь отключено. */
  onTakenOver: () => void;
  /** Меняется — человек нажал «Продолжить здесь»: подключаемся снова. */
  resumeSignal: number;
  /** Что было включено до перезагрузки вкладки — вернуть после подключения. */
  initialWanted?: WantedMedia;
  /** Включённое изменилось (для `rejoin-state.ts`). */
  onWantedChange?: (wanted: WantedMedia) => void;
}) {
  const room = useRoomContext();
  const callbacks = useRef({ restoreCamera, onRejoined, onBlocked, onTakenOver, onWantedChange });
  callbacks.current = { restoreCamera, onRejoined, onBlocked, onTakenOver, onWantedChange };
  // Что было включено — переживает перезапуск эффекта по «Продолжить здесь».
  const wantedRef = useRef<WantedMedia>(initialWanted ?? { camera: false, microphone: false });

  useEffect(() => {
    let finished = false;
    let busy = false;
    let attempt = 0;
    let nextTryAt = 0;
    let settleUntil = 0;
    let notConnectedSince = 0;
    let zombieSince = 0;
    /** Отключаем сами в `unstick` — `CLIENT_INITIATED` тогда не финал. */
    let unsticking = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    // Что было включено, пока связь была: при обрыве публикации уже сняты.
    const remember = () => {
      if (room.state !== ConnectionState.Connected || Date.now() < settleUntil) return;
      const next = {
        camera: room.localParticipant.isCameraEnabled,
        microphone: room.localParticipant.isMicrophoneEnabled,
      };
      const prev = wantedRef.current;
      if (prev.camera === next.camera && prev.microphone === next.microphone) return;
      wantedRef.current = next;
      callbacks.current.onWantedChange?.(next);
    };

    // Вернуть включённое, если после (пере)подключения его нет: LiveKit сам
    // переопубликует треки при восстановлении, это — страховка.
    const ensurePublished = async () => {
      if (finished || room.state !== ConnectionState.Connected) return;
      const participant = room.localParticipant;
      if (participant.permissions && !participant.permissions.canPublish) return;
      const wanted = wantedRef.current;
      if (wanted.microphone && !participant.isMicrophoneEnabled) {
        await participant
          .setMicrophoneEnabled(true)
          .catch((err: unknown) => reportMediaDeviceError("microphone", err));
      }
      if (wanted.camera && !participant.isCameraEnabled) {
        await callbacks.current
          .restoreCamera(participant)
          .catch((err: unknown) => reportMediaDeviceError("camera", err));
      }
    };
    const settle = () => {
      settleUntil = Date.now() + SETTLE_MS;
      for (const ms of ENSURE_AFTER_MS) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          void ensurePublished();
        }, ms);
        timers.add(timer);
      }
    };
    const onReconnecting = () => {
      remember();
      // Пока восстанавливается — не запоминаем «ничего не опубликовано».
      settleUntil = Number.POSITIVE_INFINITY;
    };

    // Комната застряла не в `Disconnected` (см. ZOMBIE_AFTER_MS) — отключаем
    // её сами, дальше обычное восстановление.
    const unstick = async () => {
      const now = Date.now();
      const state = room.state;
      if (state === ConnectionState.Connected || state === ConnectionState.Disconnected) {
        notConnectedSince = 0;
        zombieSince = 0;
        return;
      }
      if (!notConnectedSince) notConnectedSince = now;
      const engineClosed = room.engine?.isClosed ?? false;
      zombieSince = engineClosed ? zombieSince || now : 0;
      const zombie = zombieSince > 0 && now - zombieSince >= ZOMBIE_AFTER_MS;
      if (!zombie && now - notConnectedSince < STUCK_AFTER_MS) return;
      reportLiveKitConnectionFailed(
        lessonId,
        new Error(zombie ? "room stuck reconnecting with closed engine" : "room stuck not connected"),
        "recover",
      );
      notConnectedSince = 0;
      zombieSince = 0;
      busy = true;
      unsticking = true;
      try {
        await room.disconnect();
      } catch {
        // Движок уже закрыт — нам нужно только состояние `Disconnected`.
      } finally {
        unsticking = false;
        busy = false;
      }
    };

    const recover = async () => {
      if (finished || busy) return;
      await unstick();
      if (finished || busy || room.state !== ConnectionState.Disconnected || Date.now() < nextTryAt) return;
      busy = true;
      try {
        const data = await apiFetch<JoinLessonResponse>(`/lessons/${lessonId}/join`, { method: "POST" });
        if (finished || room.state !== ConnectionState.Disconnected) return;
        callbacks.current.onRejoined(data);
        await room.connect(data.media.url, data.media.token, MEDIA_CONNECT_OPTIONS);
        attempt = 0;
        // Не вернулись микрофон или камера — человек должен узнать, иначе он
        // говорит, а его после восстановления связи не слышно.
        await ensurePublished();
      } catch (err) {
        reportLiveKitConnectionFailed(lessonId, err, "recover");
        if (callbacks.current.onBlocked(err)) {
          finished = true;
          return;
        }
        nextTryAt = Date.now() + Math.min(3000 * 2 ** attempt, RETRY_MAX_MS);
        attempt += 1;
      } finally {
        busy = false;
      }
    };

    const onDisconnected = (reason?: DisconnectReason) => {
      if (unsticking) return;
      if (reason !== undefined && FINAL_DISCONNECT_REASONS.has(reason)) finished = true;
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) callbacks.current.onTakenOver();
    };

    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.SignalReconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, settle);
    room.on(RoomEvent.Connected, settle);
    room.on(RoomEvent.LocalTrackPublished, remember);
    room.on(RoomEvent.LocalTrackUnpublished, remember);
    room.on(RoomEvent.Disconnected, onDisconnected);
    // Эффект перезапустился на уже подключённой комнате («Продолжить здесь»).
    if (room.state === ConnectionState.Connected) settle();
    // Раз в несколько секунд: запоминаем включённое и, если комната в
    // `Disconnected` (первое подключение не удалось или переподключения
    // исчерпаны), подключаем заново. Пока идёт подключение или LiveKit
    // переподключается сам, состояние другое — не вмешиваемся.
    // «Продолжить здесь» — не ждать следующей проверки.
    if (resumeSignal > 0) void recover();
    const interval = setInterval(() => {
      remember();
      void recover();
    }, CHECK_MS);
    return () => {
      finished = true;
      clearInterval(interval);
      for (const timer of timers) clearTimeout(timer);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.SignalReconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, settle);
      room.off(RoomEvent.Connected, settle);
      room.off(RoomEvent.LocalTrackPublished, remember);
      room.off(RoomEvent.LocalTrackUnpublished, remember);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room, lessonId, resumeSignal]);

  return null;
}
