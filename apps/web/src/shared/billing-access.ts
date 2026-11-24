import { useEffect, useState } from "react";

import { apiFetch } from "./api-client.js";
import { useAuthStore } from "./auth-store.js";

/**
 * Есть ли раздел «Тариф»: да — репетитор в своём личном пространстве (и
 * супер-админ в «Матисе»), нет — любой участник школы, включая
 * администратора (решение владельца 2026-11-24). Решает сервер
 * (`/billing/access`), ответ кешируется на пользователя и пространство.
 */
let cached: { key: string; ok: Promise<boolean> } | null = null;

export function useBillingAccess(enabled: boolean): boolean {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const schoolId = useAuthStore((s) => s.user?.schoolId ?? null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    setOk(false);
    if (!enabled || !userId) return;
    const key = `${userId}:${schoolId}`;
    if (cached?.key !== key) {
      cached = {
        key,
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
  }, [enabled, userId, schoolId]);
  return enabled && ok;
}
