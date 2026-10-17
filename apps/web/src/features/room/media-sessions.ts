import { MEDIA_SESSION_SEPARATOR, type ParticipantSnapshot } from "@school/shared";

/**
 * Несколько вкладок с аккаунта персонала (2026-10-17): вторая и следующие
 * входят в LiveKit как `<id>~2` … — в списке урока человек один, а плитки
 * у каждой вкладки свои («Анна (2)»).
 */
export function mediaSessionOf(identity: string): { participantId: string; slot: number } {
  const at = identity.lastIndexOf(MEDIA_SESSION_SEPARATOR);
  const slot = at > 0 ? Number(identity.slice(at + 1)) : NaN;
  return Number.isInteger(slot) && slot >= 2
    ? { participantId: identity.slice(0, at), slot }
    : { participantId: identity, slot: 1 };
}

/** Плитки дополнительных вкладок — копии участника под identity вкладки. */
export function withExtraSessions(
  participants: ParticipantSnapshot[],
  live: readonly { identity: string }[],
): ParticipantSnapshot[] {
  const extra: ParticipantSnapshot[] = [];
  for (const { identity } of live) {
    const { participantId, slot } = mediaSessionOf(identity);
    if (slot === 1) continue;
    const base = participants.find((p) => p.userId === participantId);
    if (!base?.connected || base.hidden) continue;
    extra.push({ ...base, userId: identity, fullName: `${base.fullName} (${slot})`, handRaised: false, pinned: false });
  }
  return extra.length > 0 ? [...participants, ...extra] : participants;
}

/** «Своя» плитка: у второй и следующих вкладок это плитка под их identity. */
export function selfTileId(selfId: string | undefined, localIdentity: string | undefined): string | undefined {
  if (!selfId || !localIdentity) return selfId;
  return mediaSessionOf(localIdentity).participantId === selfId ? localIdentity : selfId;
}
