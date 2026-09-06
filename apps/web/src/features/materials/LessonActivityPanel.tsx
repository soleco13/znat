import { useState } from "react";

import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { MaterialPicker } from "./MaterialPicker.js";
import { createActivity } from "./activity-api.js";

/**
 * Панель «Задание» в drawer урока (Э12.7). Учитель — только выдача материала
 * классу; ученик — кнопка открыть задание на стейдже. Прогресс класса,
 * ответы учеников и разбор живут на стейдже (`ActivityStage`), не здесь —
 * drawer узкий.
 */
export function LessonActivityPanel({
  lessonId,
  isTeacher,
  activeActivityId,
  onShowOnStage,
}: {
  lessonId: string;
  isTeacher: boolean;
  activeActivityId: string | null;
  /** Э12.7/§7.3: вывести выданное задание на стейдж урока (плитки → лента). */
  onShowOnStage?: () => void;
}) {
  const [justLaunchedId, setJustLaunchedId] = useState<string | null>(null);
  const activityId = justLaunchedId ?? activeActivityId;

  return (
    <div className="space-y-3">
      {activityId && onShowOnStage ? (
        <Button variant="outline" size="sm" className="w-full" onClick={onShowOnStage}>
          {isTeacher ? "Показать классу на весь экран" : "Открыть задание на весь экран"}
        </Button>
      ) : null}

      {isTeacher ? (
        <LaunchForm lessonId={lessonId} activityId={activityId} onLaunched={setJustLaunchedId} />
      ) : activityId ? (
        <p className="text-sm text-muted-foreground">
          Задание открыто на экране — решайте там. Ответы сохраняются автоматически.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Учитель ещё не выдавал задание.</p>
      )}
    </div>
  );
}

function LaunchForm({
  lessonId,
  activityId,
  onLaunched,
}: {
  lessonId: string;
  activityId: string | null;
  onLaunched: (activityId: string) => void;
}) {
  const [materialId, setMaterialId] = useState("");
  const [timerSeconds, setTimerSeconds] = useState("");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLaunch(e: React.FormEvent) {
    e.preventDefault();
    if (!materialId) return;
    setLaunching(true);
    setError(null);
    try {
      const dto = await createActivity(lessonId, {
        materialId,
        timerSeconds: timerSeconds.trim() ? Number(timerSeconds) : undefined,
      });
      onLaunched(dto.id);
    } catch {
      setError("Не удалось запустить задание");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <form onSubmit={handleLaunch} className="space-y-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Материал</Label>
        <MaterialPicker value={materialId} onChange={setMaterialId} className="w-full" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="la-timer" className="text-xs">
          Ограничение, сек
        </Label>
        <Input
          id="la-timer"
          inputMode="numeric"
          value={timerSeconds}
          onChange={(e) => setTimerSeconds(e.target.value)}
          placeholder="без лимита"
        />
      </div>
      <Button type="submit" className="w-full" loading={launching} disabled={!materialId}>
        {launching ? "Запускаем…" : activityId ? "Выдать заново" : "Выдать классу"}
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {activityId ? (
        <p className="text-xs text-muted-foreground">
          Задание выдано. Прогресс класса и ответы учеников — на экране задания.
        </p>
      ) : null}
    </form>
  );
}
