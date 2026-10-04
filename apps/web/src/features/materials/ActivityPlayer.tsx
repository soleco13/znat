import { useCallback, useEffect, useRef, useState } from "react";
import type { MyActivity } from "@school/shared";

import { ApiError } from "@/shared/api-client";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { getMyActivity, saveActivityPosition } from "./activity-api.js";
import { MaterialPlayer } from "./MaterialPlayer.js";

/** Пауза после смены слайда перед отправкой позиции на сервер. */
const POSITION_DEBOUNCE_MS = 800;
/**
 * Повторы загрузки задания. На мобильной сети одно оборванное HTTP/2-соединение
 * оставляло ученика на «Не удалось загрузить задание» до перезагрузки страницы,
 * а без кнопки «Свернуть» он не видел и доску с демонстрацией (E2E 2026-10-04).
 */
const LOAD_RETRY_DELAYS_MS = [2000, 5000, 10_000, 20_000];

/** 403/404 — задание закрыто или недоступно, повтор не поможет. */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500;
}

/**
 * Грузит индивидуальную копию задания (`GET /activities/:id/my`) и рендерит
 * плеер. Э12.5: задание всегда на уроке; ученик — гость по ссылке урока,
 * `getMyActivity` ходит по гостевой куке сессии.
 *
 * Доп. Э13: материал слайдами. При смене слайда шлём серверу id первого блока
 * (debounced) — чтобы учитель открыл материал ровно на том месте, где ученик.
 * `annotationOverlay` — слой пометок учителя (опрашивается стейджем урока).
 */
export function ActivityPlayer({
  activityId,
  annotationOverlay,
  showHead,
  barEnd,
}: {
  activityId: string;
  annotationOverlay?: React.ReactNode;
  showHead?: boolean;
  barEnd?: React.ReactNode;
}) {
  const [activity, setActivity] = useState<MyActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Меняется — загрузить заново (автоповтор, кнопка «Повторить», сеть вернулась). */
  const [loadKey, setLoadKey] = useState(0);
  const posTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setActivity(null);
    setError(null);
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const load = (attempt: number) => {
      getMyActivity(activityId)
        .then((data) => {
          if (cancelled) return;
          setActivity(data);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const delay = LOAD_RETRY_DELAYS_MS[attempt];
          if (delay !== undefined && isRetryable(err)) {
            retryTimer = setTimeout(() => load(attempt + 1), delay);
            return;
          }
          setError(isRetryable(err) ? "Не удалось загрузить задание — проверьте интернет" : "Задание недоступно");
        });
    };
    load(0);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [activityId, loadKey]);

  // Сеть вернулась — попробовать снова, не дожидаясь клика.
  useEffect(() => {
    if (!error) return;
    const onOnline = () => setLoadKey((k) => k + 1);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [error]);

  useEffect(
    () => () => {
      if (posTimer.current) clearTimeout(posTimer.current);
    },
    [],
  );

  const handlePositionChange = useCallback(
    (blockId: string) => {
      if (posTimer.current) clearTimeout(posTimer.current);
      posTimer.current = setTimeout(() => {
        void saveActivityPosition(activityId, blockId).catch(() => undefined);
      }, POSITION_DEBOUNCE_MS);
    },
    [activityId],
  );

  if (error)
    return (
      <div className="flex flex-col gap-3">
        {barEnd ? <div className="flex justify-end">{barEnd}</div> : null}
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => setLoadKey((k) => k + 1)}>
              Повторить
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  if (!activity) return <CenteredSpinner label="Загрузка задания…" />;
  return (
    <MaterialPlayer
      activity={activity}
      autosaveActivityId={activityId}
      slideOverlay={annotationOverlay}
      initialSlideBlockId={activity.currentBlockId}
      onPositionChange={handlePositionChange}
      showHead={showHead}
      barEnd={barEnd}
    />
  );
}
