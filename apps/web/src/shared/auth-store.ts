import { create } from "zustand";
import type { MeResponse } from "@school/shared";

interface AuthState {
  accessToken: string | null;
  user: MeResponse | null;
  setAuth: (accessToken: string, user: MeResponse) => void;
  clearAuth: () => void;
}

/**
 * Только в памяти процесса вкладки — намеренно без localStorage/sessionStorage
 * (правило CLAUDE.md). При перезагрузке страницы access-токен восстанавливается
 * через POST /auth/refresh по httpOnly refresh-cookie.
 */
export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setAuth: (accessToken, user) => set({ accessToken, user }),
  clearAuth: () => set({ accessToken: null, user: null }),
}));
