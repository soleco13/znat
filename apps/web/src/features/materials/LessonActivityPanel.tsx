import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { MaterialPicker } from "./MaterialPicker.js";
import { createActivity } from "./activity-api.js";
import { ActivityPlayer } from "./ActivityPlayer.js";
import { ActivityTeacherTabs } from "./ActivityTeacherTabs.js";

/**
 * Сборка учебного функционала (Э8) внутри урока. Один активный `activityId`
 * на экран одновременно; `activeActivityId` приходит от `RoomPage`.
 */
export function LessonActivityPanel({
  lessonId,
  isTeacher,
  activeActivityId,
  reviewSignal,
}: {
  lessonId: string;
  isTeacher: boolean;
  activeActivityId: string | null;
  reviewSignal: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const [justLaunchedId, setJustLaunchedId] = useState<string | null>(null);
  const activityId = justLaunchedId ?? activeActivityId;

  return (
    <Card>
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <h2 className="ds-label">Задание</h2>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div className="border-t border-border p-4">
          {isTeacher ? (
            <TeacherActivityView
              lessonId={lessonId}
              activityId={activityId}
              onLaunched={setJustLaunchedId}
              reviewSignal={reviewSignal}
            />
          ) : activityId ? (
            <ActivityPlayer activityId={activityId} />
          ) : (
            <p className="text-sm text-muted-foreground">Учитель ещё не выдавал задание</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function TeacherActivityView({
  lessonId,
  activityId,
  onLaunched,
  reviewSignal,
}: {
  lessonId: string;
  activityId: string | null;
  onLaunched: (activityId: string) => void;
  reviewSignal: number;
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
        mode: "lesson",
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
    <div className="space-y-4">
      <form onSubmit={handleLaunch} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Материал</Label>
          <MaterialPicker value={materialId} onChange={setMaterialId} className="w-72" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="la-timer" className="text-xs">Ограничение, сек</Label>
          <Input
            id="la-timer"
            inputMode="numeric"
            value={timerSeconds}
            onChange={(e) => setTimerSeconds(e.target.value)}
            placeholder="без лимита"
            className="w-32"
          />
        </div>
        <Button type="submit" loading={launching} disabled={!materialId}>
          {launching ? "Запускаем…" : "Выдать классу"}
        </Button>
      </form>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {activityId ? (
        <ActivityTeacherTabs key={activityId} activityId={activityId} reviewSignal={reviewSignal} />
      ) : null}
    </div>
  );
}
