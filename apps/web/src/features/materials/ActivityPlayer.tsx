import { useEffect, useState } from "react";
import type { MyActivity } from "@school/shared";

import { Alert, AlertDescription } from "@/shared/ui/alert";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { getMyActivity } from "./activity-api.js";
import { MaterialPlayer } from "./MaterialPlayer.js";

/**
 * Грузит индивидуальную копию задания (`GET /activities/:id/my`) и рендерит
 * плеер. Э12.5: задание всегда на уроке; ученик — гость по ссылке урока,
 * `getMyActivity` ходит по гостевой куке сессии.
 */
export function ActivityPlayer({ activityId }: { activityId: string }) {
  const [activity, setActivity] = useState<MyActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (!activity) return <CenteredSpinner label="Загрузка задания…" />;
  return <MaterialPlayer activity={activity} autosaveActivityId={activityId} />;
}
