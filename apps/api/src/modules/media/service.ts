import { AccessToken, TrackSource } from "livekit-server-sdk";
import type { MediaConnection, ParticipantPermissions } from "@school/shared";
import { env } from "../../plugins/env.js";

const GRACE_AFTER_END_MS = 15 * 60 * 1000;
const MIN_TTL_SECONDS = 60;

/**
 * TTL = время до конца урока + 15 минут (§8.4 ТЗ). Читать построчно (§1.2
 * CLAUDE.md) — токен даёт доступ к аудио, ошибка здесь тихо не проявится.
 */
export function ttlSecondsUntilLessonGraceEnd(lessonStartsAt: Date, lessonDurationMin: number): number {
  const scheduledEndMs = lessonStartsAt.getTime() + lessonDurationMin * 60_000;
  const expiresAtMs = scheduledEndMs + GRACE_AFTER_END_MS;
  const secondsLeft = Math.floor((expiresAtMs - Date.now()) / 1000);
  return Math.max(MIN_TTL_SECONDS, secondsLeft);
}

export async function createParticipantConnection(params: {
  livekitRoom: string;
  userId: string;
  fullName: string;
  permissions: ParticipantPermissions;
  lessonStartsAt: Date;
  lessonDurationMin: number;
}): Promise<MediaConnection> {
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: params.userId,
    name: params.fullName,
    ttl: ttlSecondsUntilLessonGraceEnd(params.lessonStartsAt, params.lessonDurationMin),
  });
  at.addGrant({
    roomJoin: true,
    room: params.livekitRoom,
    canSubscribe: true,
    // Стоп-лист Э2: только аудио. Даже если у ученика canPublish=true (право
    // "canSpeak"), источник трека жёстко ограничен микрофоном на уровне
    // токена — камеру и демонстрацию экрана публиковать нечем до Э5/Э7.
    canPublish: params.permissions.canSpeak,
    canPublishSources: [TrackSource.MICROPHONE],
    canPublishData: false,
    hidden: false,
  });
  const token = await at.toJwt();
  return { token, url: env.LIVEKIT_PUBLIC_URL };
}
