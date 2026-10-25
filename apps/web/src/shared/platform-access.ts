import { useEffect, useState } from "react";

import { apiFetch } from "./api-client.js";
import { useAuthStore } from "./auth-store.js";

/**
 * Есть ли у вошедшего доступ к разделу «Платформа» (супер-админ). Сервер —
 * единственный судья (`/platform/access`); ответ кешируется на пользователя,
 * чтобы меню не дёргало запрос на каждом переходе, а после смены аккаунта
 * спрашивало заново.
 */
let cached: { userId: string; ok: Promise<boolean> } | null = null;

export function usePlatformAccess(enabled: boolean): boolean {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    setOk(false);
    if (!enabled || !userId) return;
    if (cached?.userId !== userId) {
      cached = {
        userId,
        ok: apiFetch<{ ok: boolean }>("/platform/access").then(
          (r) => r.ok,
          () => false,
        ),
      };
    }
    let alive = true;
    void cached.ok.then((v) => alive && setOk(v));
    return () => {
      alive = false;
    };
  }, [enabled, userId]);
  return enabled && ok;
}
