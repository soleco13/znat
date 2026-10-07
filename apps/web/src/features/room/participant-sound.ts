/**
 * Звуковой сигнал входа/выхода участника из урока (LiveKit-комнаты).
 * Файлы лежат в `public/sounds` (правило CLAUDE.md — никаких чужих CDN,
 * всё в бандле).
 */

const SOUND_URL: Record<"joined" | "left", string> = {
  joined: "/sounds/participant-joined.mp3",
  left: "/sounds/participant-left.mp3",
};

/** Не чаще одного сигнала за этот срок: при массовом входе класса — один звук, а не 30. */
const MIN_GAP_MS = 3_000;
let lastPlayedAt = 0;

export function playParticipantSound(kind: "joined" | "left"): void {
  const now = Date.now();
  if (now - lastPlayedAt < MIN_GAP_MS) return;
  lastPlayedAt = now;
  const audio = new Audio(SOUND_URL[kind]);
  // Автоплей может быть заблокирован браузером вне жеста пользователя —
  // тогда просто нет звука, урок это не должно ронять.
  void audio.play().catch(() => undefined);
}
