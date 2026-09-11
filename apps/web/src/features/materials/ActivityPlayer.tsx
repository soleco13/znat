import { useCallback, useEffect, useRef, useState } from "react";
import type { MyActivity } from "@school/shared";

import { Alert, AlertDescription } from "@/shared/ui/alert";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { getMyActivity, saveActivityPosition } from "./activity-api.js";
import { MaterialPlayer } from "./MaterialPlayer.js";

/** Пауза после смены слайда перед отправкой позиции на сервер. */
const POSITION_DEBOUNCE_MS = 800;

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
}: {
  activityId: string;
  annotationOverlay?: React.ReactNode;
}) {
  const [activity, setActivity] = useState<MyActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const posTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setActivity(null);
    setError(null);
    let cancelled = false;
    getMyActivity(activityId)
      .then((data) => !cancelled && setActivity(data))
      .catch(() => !cancelled && setError("Не удалось загрузить задание"));
    return () => {
      cancelled = true;
    };
  }, [activityId]);

  useEffect(
    () => () => {
      if (posTimer.current) clearTimeout(posTimer.current);
    },
    [],
  );

  const handleSlideChange = useCallback(
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
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (!activity) return <CenteredSpinner label="Загрузка задания…" />;
  return (
    <MaterialPlayer
      activity={activity}
      autosaveActivityId={activityId}
      slideOverlay={annotationOverlay}
      initialSlideBlockId={activity.currentBlockId}
      onSlideChange={handleSlideChange}
    />
  );
}
