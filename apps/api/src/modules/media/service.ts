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
 * учителя (Э5.1) разрешена ролью (§5.2 ТЗ: «камера учителя — всегда», не
 * переключаемое право), камера ученика (Э6.1) — отдельным переключаемым
 * правом `canPublishVideo` (§5.2 ТЗ: «публикуется только когда ученик в
 * активной сетке», выдаёт учитель, как и canSpeak). Разрешение на 360p, а
 * не 720p, — это НЕ часть гранта: LiveKit не ограничивает резолюцию
 * публикуемого трека на уровне прав, это чисто клиентская настройка
 * VideoCaptureOptions (`RoomPage.tsx`) — тот же доверительный периметр, что
 * уже принят для остальных клиентских настроек качества в проекте.
 * Демонстрация экрана (Э7.1/Э7.4) — источник TrackSource.SCREEN_SHARE,
 * управляется правом `canShareScreen` (существовало в схеме с ранних
 * этапов как задел, реально не выдавало источник до сих пор — стоп-лист
 * Э5/Э6). Право одно и то же для учителя (получает его по умолчанию,
 * `presence.ts#defaultPermissions`) и для ученика по разрешению учителя
 * (Э7.4) — не отдельная роль-проверка, как у камеры учителя, потому что
 * демонстрация никогда не была «всегда включена по роли». Максимум 1
 * одновременно и приоритет учителю (§5.2 ТЗ) — НЕ часть гранта (грант лишь
 * разрешает ИСТОЧНИК, не следит за тем, сколько таких треков уже
 * опубликовано в комнате) — Э7.2 решает это отдельной вебхук-логикой в
 * `rooms/service.ts#handleScreenShareStartedWebhook` (`findOtherActiveScreenShares`/
 * `muteScreenShare` ниже — её инструменты).
 * Общая для выдачи токена (`createParticipantConnection`) и живого
 * обновления прав (`updateLivePermissions`) — грант должен совпадать в
 * обоих местах.
 */
function buildPublishGrant(permissions: ParticipantPermissions, role: Role) {
  const isStaff = role === "teacher" || role === "admin";
  const canPublishCamera = isStaff || permissions.canPublishVideo;
  const sources = [TrackSource.MICROPHONE];
  if (canPublishCamera) sources.push(TrackSource.CAMERA);
  if (permissions.canShareScreen) sources.push(TrackSource.SCREEN_SHARE);
  return {
    canSubscribe: true,
    canPublish: permissions.canSpeak || canPublishCamera || permissions.canShareScreen,
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
    // Э6.1: роль как LiveKit-атрибут участника — клиенту (`TeacherVideoTile`)
    // нужно отличить камеру учителя от камеры ученика с granted canPublishVideo
    // без похода за отдельным WS presence-списком. Роль на время урока
    // неизменна, живое обновление (в отличие от прав) не требуется.
    attributes: { role: params.role },
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

/** Общий поиск+мьют трека по источнику — используется и микрофоном (Э2.5), и демонстрацией экрана (Э7.2). */
async function muteTrackBySource(
  livekitRoom: string,
  identity: string,
  source: TrackSource,
  muted: boolean,
): Promise<void> {
  let participant;
  try {
    participant = await roomService.getParticipant(livekitRoom, identity);
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw err;
  }
  const track = participant.tracks.find((t) => t.source === source);
  if (!track) return;
  await roomService.mutePublishedTrack(livekitRoom, identity, track.sid, muted);
}

/** Учитель принудительно глушит одного участника — трек выключается сразу, но не отзывает право говорить (Э2.5). */
export async function muteParticipant(livekitRoom: string, userId: string): Promise<void> {
  await muteTrackBySource(livekitRoom, userId, TrackSource.MICROPHONE, true);
}

/**
 * «Мьют всех» — глушит микрофоны перечисленных участников. Список формирует
 * вызывающая сторона (обычно все подключённые ученики, без учителя и
 * со-учителей) — так надёжнее, чем «все, кроме …», и не зависит от состава
 * ролей в комнате.
 */
export async function muteMicrophones(livekitRoom: string, userIds: string[]): Promise<void> {
  await Promise.all(userIds.map((userId) => muteTrackBySource(livekitRoom, userId, TrackSource.MICROPHONE, true)));
}

/**
 * Список identity участников с уже АКТИВНОЙ (не замьюченной) демонстрацией
 * экрана в комнате, кроме `excludeIdentity` (обычно — тот, кто только что
 * сам начал делиться, Э7.2). LiveKit — источник истины по факту публикации
 * и mute-состоянию трека, не наш `presence` (который про права, а не про
 * текущее состояние трека).
 */
export async function findOtherActiveScreenShares(livekitRoom: string, excludeIdentity?: string): Promise<string[]> {
  const participants = await roomService.listParticipants(livekitRoom);
  return participants
    .filter((p) => p.identity !== excludeIdentity)
    .filter((p) => p.tracks.some((t) => t.source === TrackSource.SCREEN_SHARE && !t.muted))
    .map((p) => p.identity);
}

/** Гасит демонстрацию экрана участника (Э7.2: приоритет учителю, максимум 1 одновременно) — не отзывает право `canShareScreen`, как и `muteParticipant` не отзывает `canSpeak`. */
export async function muteScreenShare(livekitRoom: string, identity: string): Promise<void> {
  await muteTrackBySource(livekitRoom, identity, TrackSource.SCREEN_SHARE, true);
}
