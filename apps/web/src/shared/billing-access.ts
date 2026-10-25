import { useEffect, useState } from "react";

import { apiFetch } from "./api-client.js";
import { useAuthStore } from "./auth-store.js";

/**
 * Видит ли учитель раздел «Тариф»: да — репетитор в своём личном
 * пространстве, нет — учитель внутри школы. Решает сервер (`/billing/access`),
 * ответ кешируется на пользователя.
 */
let cached: { userId: string; ok: Promise<boolean> } | null = null;

export function useBillingAccess(enabled: boolean): boolean {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    setOk(false);
    if (!enabled || !userId) return;
    if (cached?.userId !== userId) {
      cached = {
        userId,
        ok: apiFetch<{ ok: boolean }>("/billing/access").then(
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
