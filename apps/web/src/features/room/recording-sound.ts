/**
 * Звуковое уведомление о начале/окончании записи урока — слышат ВСЕ
 * участники (учитель и ученики), не только тот, кто нажал кнопку.
 * Триггерится из `recording_status` в `RoomPage#handleMessage` — то же
 * сообщение, которым сервер шлёт баннер согласия (152-ФЗ).
 *
 * Файлы лежат в `public/sounds` (правило CLAUDE.md — никаких чужих CDN,
 * всё в бандле).
 */

const SOUND_URL: Record<"started" | "stopped", string> = {
  started: "/sounds/recording-started.mp3",
  stopped: "/sounds/recording-stopped.mp3",
};

export function playRecordingSound(active: boolean): void {
  const audio = new Audio(SOUND_URL[active ? "started" : "stopped"]);
  // Автоплей может быть заблокирован браузером, если это не связано с
  // прямым жестом пользователя (сообщение прилетает по WS от чужого
  // клика) — тогда просто нет звука, урок это не должно ронять.
  void audio.play().catch(() => undefined);
}
