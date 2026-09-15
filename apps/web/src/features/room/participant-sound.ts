/**
 * Звуковой сигнал входа/выхода участника из урока (LiveKit-комнаты).
 * Файлы лежат в `public/sounds` (правило CLAUDE.md — никаких чужих CDN,
 * всё в бандле).
 */

const SOUND_URL: Record<"joined" | "left", string> = {
  joined: "/sounds/participant-joined.wav",
  left: "/sounds/participant-left.wav",
};

export function playParticipantSound(kind: "joined" | "left"): void {
  const audio = new Audio(SOUND_URL[kind]);
  // Автоплей может быть заблокирован браузером вне жеста пользователя —
  // тогда просто нет звука, урок это не должно ронять.
  void audio.play().catch(() => undefined);
}
