import { create } from "zustand";
import type { GuestSession } from "@school/shared";

interface GuestSessionState {
  /**
   * Гостевая личность на текущем уроке — введённое имя + стабильный
   * `guestId` из httpOnly-куки `guest_session` (Э12.4). Только в памяти
   * вкладки (правило CLAUDE.md — без localStorage/sessionStorage): при
   * перезагрузке восстанавливается через `GET /guest/session` по куке.
   */
  session: GuestSession | null;
  setSession: (session: GuestSession) => void;
  clearSession: () => void;
}

export const useGuestSessionStore = create<GuestSessionState>((set) => ({
  session: null,
  setSession: (session) => set({ session }),
  clearSession: () => set({ session: null }),
}));
