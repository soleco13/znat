import { useState } from "react";
import { createActivity } from "./activity-api.js";
import { ActivityPlayer } from "./ActivityPlayer.js";
import { ActivityTeacherTabs } from "./ActivityTeacherTabs.js";

/**
 * Сборка учебного функционала (Э8) внутри урока — первое место, где
 * `MaterialPlayer`/`ClassProgressPanel`/`QuestionAnalyticsPanel`/`ReviewPanel`/
 * `GradingQueue` реально подключаются к экрану урока, а не остаются
 * готовыми, но изолированными компонентами (пробел, зафиксированный в
 * `docs/CURRENT_STAGE.md` при закрытии Э8.12).
 *
 * Один активный `activityId` на экран одновременно — то же допущение, что
 * и у сигнала `activity_started` в `rooms/service.ts` (второе задание
 * поверх первого сервер не запрещает, панель просто следует за последним
 * запущенным). `activeActivityId` приходит от `RoomPage`: WS-сигнал
 * `activity_started` в реальном времени плюс фолбэк-поллинг
 * (`listLessonActivities`) при заходе в уже идущий урок.
 */
export function LessonActivityPanel({
  lessonId,
  isTeacher,
  activeActivityId,
  reviewSignal,
}: {
  lessonId: string;
  isTeacher: boolean;
  /** id последней запущенной активности урока, либо `null` — ничего не выдавалось. */
  activeActivityId: string | null;
  /** Растёт при каждом WS `activity_reviewed` — форсирует remount `ReviewPanel` (см. `key` ниже), чтобы разбор перечитался без ручного обновления страницы. */
  reviewSignal: number;
}) {
  const [expanded, setExpanded] = useState(true);
  // Пока учитель не перезагрузил страницу, id только что запущенного им
  // задания приходит СВОИМ ответом `createActivity`, а не WS `activity_started`
  // (тому же клиенту, что его запустил, свой WS-сигнал не нужен — он уже
  // знает id из ответа). После перезагрузки/у другого учителя работает
  // обычный путь через `activeActivityId`.
  const [justLaunchedId, setJustLaunchedId] = useState<string | null>(null);
  const activityId = justLaunchedId ?? activeActivityId;

  return (
    <div className="rounded border p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-600">Задание</h2>
        <button onClick={() => setExpanded((v) => !v)} className="text-xs text-slate-400">
          {expanded ? "Свернуть" : "Развернуть"}
        </button>
      </div>
      {expanded &&
        (isTeacher ? (
          <TeacherActivityView
            lessonId={lessonId}
            activityId={activityId}
            onLaunched={setJustLaunchedId}
            reviewSignal={reviewSignal}
          />
        ) : activityId ? (
          <ActivityPlayer activityId={activityId} />
        ) : (
          <p className="text-xs text-slate-400">Учитель ещё не выдавал задание</p>
        ))}
    </div>
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
    if (!materialId.trim()) return;
    setLaunching(true);
    setError(null);
    try {
      const dto = await createActivity(lessonId, {
        materialId: materialId.trim(),
        mode: "lesson",
        timerSeconds: timerSeconds.trim() ? Number(timerSeconds) : undefined,
      });
      onLaunched(dto.id);
    } catch {
      setError("Не удалось запустить задание — проверьте id материала");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Редактора материалов ещё нет (Э9) — методист/учитель заводит материал JSON-ом через seed-скрипт/Postman (стоп-лист Э8) и вставляет сюда его id. */}
      <form onSubmit={handleLaunch} className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-500">
          id материала
          <input
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
            placeholder="uuid материала"
            className="block rounded border px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-500">
          таймер, сек (необязательно)
          <input
            value={timerSeconds}
            onChange={(e) => setTimerSeconds(e.target.value)}
            placeholder="600"
            className="block w-24 rounded border px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={launching}
          className="rounded border bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-40"
        >
          {launching ? "Запускаем…" : "Выдать классу"}
        </button>
      </form>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {activityId && <ActivityTeacherTabs key={activityId} activityId={activityId} reviewSignal={reviewSignal} />}
    </div>
  );
}
