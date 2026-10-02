import { useCallback, useEffect, useRef, useState } from "react";
import type { QuestionResponse } from "@school/shared";
import { saveResponse } from "./activity-api.js";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

/** Пауза после последнего изменения перед автосохранением (§8 ТЗ: «каждые 5 сек»). */
const DEBOUNCE_MS = 5_000;
/** Повтор после неудачного сохранения. */
const RETRY_MS = 10_000;

/**
 * Автосохранение ответов задания (Э8.7, DoD: «обрыв связи не теряет ответы»).
 *
 * - `queue(questionId, response)` — ставит ответ в очередь; таймер на 5 сек
 *   от последнего изменения (сбрасывается при каждом новом).
 * - при `visibilitychange → hidden` и `beforeunload` — немедленный сброс
 *   очереди с `keepalive`, чтобы уход со страницы не потерял несохранённое.
 * - неотправленное после ошибки возвращается в очередь и уходит повтором через
 *   `RETRY_MS` или со следующим изменением/сбросом; сервер идемпотентен по
 *   `(attemptId, questionId)`. `flush()` сообщает, всё ли сохранилось, —
 *   сдача без этого оценивала бы несохранённые ответы как пустые.
 *
 * Ключи очереди — `questionId`, поэтому копятся только ПОСЛЕДНИЕ значения
 * каждого вопроса, а не история промежуточных.
 */
export function useActivityAutosave(activityId: string | null) {
  const pending = useRef<Map<string, QuestionResponse>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<AutosaveStatus>("idle");

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  /** Идущее сохранение: сдача ждёт его, иначе «очередь пуста» выглядела бы успехом. */
  const inFlight = useRef<Promise<boolean> | null>(null);

  /**
   * Отправляет очередь. `true` — всё, что было в очереди, сохранено на сервере.
   * Не бросает: вызывающие с `void` (таймер, уход со страницы) не должны
   * получать необработанный reject, а сдача проверяет результат явно.
   */
  const flush = useCallback(
    async (keepalive = false): Promise<boolean> => {
      clearTimer();
      // Неудачная предыдущая отправка вернула свои ответы в очередь — они уйдут сейчас.
      if (inFlight.current) await inFlight.current;
      clearTimer();
      if (!activityId || pending.current.size === 0) return true;
      const batch = [...pending.current.entries()];
      pending.current.clear();
      setStatus("saving");
      const run = (async () => {
        try {
          await Promise.all(
            batch.map(([questionId, response]) => saveResponse(activityId, { questionId, response }, keepalive)),
          );
          setStatus((s) => (pending.current.size === 0 && s === "saving" ? "saved" : s));
          return true;
        } catch {
          for (const [q, r] of batch) if (!pending.current.has(q)) pending.current.set(q, r);
          setStatus("error");
          // Ученик может больше ничего не менять — без повтора ответ жил бы
          // только в памяти вкладки до сдачи или ухода со страницы.
          if (!timer.current) timer.current = setTimeout(() => void flush(), RETRY_MS);
          return false;
        }
      })();
      inFlight.current = run;
      try {
        return await run;
      } finally {
        if (inFlight.current === run) inFlight.current = null;
      }
    },
    [activityId],
  );

  const queue = useCallback(
    (questionId: string, response: QuestionResponse) => {
      pending.current.set(questionId, response);
      setStatus("idle");
      clearTimer();
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [flush],
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
