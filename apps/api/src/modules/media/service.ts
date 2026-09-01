import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import type { MediaConnection, ParticipantPermissions, Role } from "@school/shared";
import { env } from "../../plugins/env.js";

const GRACE_AFTER_END_MS = 15 * 60 * 1000;
const MIN_TTL_SECONDS = 60;

// `LIVEKIT_URL` — серверный адрес (ws://.../wss://...), SDK сам меняет схему на http(s)
// при твёрп-запросах (проверено по исходнику livekit-server-sdk/src/TwirpRPC.ts).
const roomService = new RoomServiceClient(env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

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

/**
 * Источники трека жёстко перечислены на уровне гранта, а не выведены из
 * одного булева canPublish — микрофон управляется правом "canSpeak", камера
 * с Э5.1 разрешена ролью (§5.2 ТЗ: «камера учителя — всегда», не переключаемое
 * право участника, в отличие от canSpeak). Демонстрация экрана — источник
 * TrackSource.SCREEN_SHARE, всё ещё не добавлен до Э7 (стоп-лист Э5). Общая
 * для выдачи токена (`createParticipantConnection`) и живого обновления прав
 * (`updateLivePermissions`) — грант должен совпадать в обоих местах.
 */
function buildPublishGrant(permissions: ParticipantPermissions, role: Role) {
  const canPublishCamera = role === "teacher" || role === "admin";
  const sources = [TrackSource.MICROPHONE];
  if (canPublishCamera) sources.push(TrackSource.CAMERA);
  return {
    canSubscribe: true,
    canPublish: permissions.canSpeak || canPublishCamera,
    canPublishSources: sources,
    canPublishData: false,
    hidden: false,
  };
}

export async function createParticipantConnection(params: {
  livekitRoom: string;
  userId: string;
  fullName: string;
  role: Role;
  permissions: ParticipantPermissions;
  lessonStartsAt: Date;
  lessonDurationMin: number;
}): Promise<MediaConnection> {
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: params.userId,
    name: params.fullName,
    ttl: ttlSecondsUntilLessonGraceEnd(params.lessonStartsAt, params.lessonDurationMin),
  });
  at.addGrant({ roomJoin: true, room: params.livekitRoom, ...buildPublishGrant(params.permissions, params.role) });
  const token = await at.toJwt();
  return { token, url: env.LIVEKIT_PUBLIC_URL };
}

function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && "status" in err && (err as { status: unknown }).status === 404;
}

/**
 * Токен LiveKit выдаётся один раз при входе и не перечитывает права при их
 * смене (JWT неизменяем) — значит `PATCH .../permissions` на уже подключённого
 * участника без этого вызова не подействует до переподключения. Читать
 * построчно (§1.2 CLAUDE.md) — тихая ошибка здесь незаметно оставит человеку
 * право говорить, которое учитель уже отозвал, либо не даст говорить тому,
 * кому только что разрешили.
 */
export async function updateLivePermissions(
  livekitRoom: string,
  userId: string,
  permissions: ParticipantPermissions,
  role: Role,
): Promise<void> {
  try {
    await roomService.updateParticipant(livekitRoom, userId, { permission: buildPublishGrant(permissions, role) });
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    // участник ещё не подключался к LiveKit (только presence) — при подключении
    // токен будет выпущен уже с актуальными правами, обновлять нечего.
  }
}

async function muteMicrophoneTrack(livekitRoom: string, identity: string, muted: boolean): Promise<void> {
  let participant;
  try {
    participant = await roomService.getParticipant(livekitRoom, identity);
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw err;
  }
  const micTrack = participant.tracks.find((t) => t.source === TrackSource.MICROPHONE);
  if (!micTrack) return;
  await roomService.mutePublishedTrack(livekitRoom, identity, micTrack.sid, muted);
}

/** Учитель принудительно глушит одного участника — трек выключается сразу, но не отзывает право говорить (Э2.5). */
export async function muteParticipant(livekitRoom: string, userId: string): Promise<void> {
  await muteMicrophoneTrack(livekitRoom, userId, true);
}

/**
 * «Мьют всех» — глушит микрофоны перечисленных участников. Список формирует
 * вызывающая сторона (обычно все подключённые ученики, без учителя и
 * со-учителей) — так надёжнее, чем «все, кроме …», и не зависит от состава
 * ролей в комнате.
 */
export async function muteMicrophones(livekitRoom: string, userIds: string[]): Promise<void> {
  await Promise.all(userIds.map((userId) => muteMicrophoneTrack(livekitRoom, userId, true)));
}
