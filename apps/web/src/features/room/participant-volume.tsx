import { useEffect } from "react";
import { useRemoteParticipants } from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";
import { create } from "zustand";

/**
 * Громкость участников — у каждого своя, только в этом браузере: ученик
 * делает тише громкого одноклассника, учителю это не передаётся. Живёт до
 * перезагрузки страницы (localStorage в проекте запрещён, CLAUDE.md).
 * 0…1 — громкость элемента `<audio>`; громче исходной браузер без WebAudio
 * не сделает.
 */
interface ParticipantVolumeState {
  volumes: ReadonlyMap<string, number>;
  setVolume: (identity: string, volume: number) => void;
}

export const useParticipantVolumeStore = create<ParticipantVolumeState>((set) => ({
  volumes: new Map(),
  setVolume: (identity, volume) =>
    set((s) => ({ volumes: new Map(s.volumes).set(identity, Math.min(1, Math.max(0, volume))) })),
}));

/** Применяет выбранную громкость к микрофону и звуку демонстрации каждого участника. */
export function ApplyParticipantVolumes() {
  const volumes = useParticipantVolumeStore((s) => s.volumes);
  // Перерисовка на подписку трека: новый `<audio>` получает громкость по умолчанию.
  const remotes = useRemoteParticipants({
    updateOnlyOn: [RoomEvent.ParticipantConnected, RoomEvent.TrackSubscribed],
  });
  useEffect(() => {
    for (const p of remotes) {
      const volume = volumes.get(p.identity) ?? 1;
      p.setVolume(volume, Track.Source.Microphone);
      p.setVolume(volume, Track.Source.ScreenShareAudio);
    }
  }, [remotes, volumes]);
  return null;
}
