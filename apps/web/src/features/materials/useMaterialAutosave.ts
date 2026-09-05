import { useCallback, useEffect, useRef, useState } from "react";
import type { Material } from "@school/shared";
import { updateMaterialDraft } from "./materials-api.js";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

/** Пауза после последнего изменения перед автосохранением — тот же приём, что `useActivityAutosave` (Э8.7), но контент один (весь черновик), не очередь по вопросам. */
const DEBOUNCE_MS = 3_000;

/**
 * Автосохранение черновика материала (Э9.3, §8 ТЗ `PUT /materials/:id`).
 * Копирует форму `useActivityAutosave` (Э8.7): дебаунс от последнего
 * изменения, немедленный сброс на `visibilitychange → hidden`/`beforeunload`
 * с `keepalive`, неудачное сохранение возвращается в очередь. Отличие —
 * очередь не по ключу (там `questionId`), а один последний черновик целиком.
 *
 * `enabled=false` (материал не в статусе `draft`, или сервер уже отказал по
 * владению/статусу — Э9.8 ещё не даёт править опубликованное) — `queue`
 * ничего не делает, `status` остаётся `idle`.
 */
export function useMaterialAutosave(materialId: string | null, enabled: boolean) {
  const pending = useRef<Material | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<AutosaveStatus>("idle");

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const flush = useCallback(
    async (keepalive = false) => {
      clearTimer();
      if (!materialId || !enabled || !pending.current) return;
      const content = pending.current;
      pending.current = null;
      setStatus("saving");
      try {
        await updateMaterialDraft(materialId, content, keepalive);
        setStatus((s) => (pending.current === null && s === "saving" ? "saved" : s));
      } catch {
        if (pending.current === null) pending.current = content;
        setStatus("error");
      }
    },
    [materialId, enabled],
  );

  const queue = useCallback(
    (content: Material) => {
      if (!materialId || !enabled) return;
      pending.current = content;
      setStatus("idle");
      clearTimer();
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [materialId, enabled, flush],
  );

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flush(true);
    };
    const onBeforeUnload = () => void flush(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      void flush(true);
    };
  }, [flush]);

  return { queue, flush, status };
}
