import { useEffect, useState } from "react";
import type { MyActivity } from "@school/shared";
import { createActivity, getMyActivity } from "./activity-api.js";
import { ClassProgressPanel } from "./ClassProgressPanel.js";
import { GradingQueue } from "./GradingQueue.js";
import { MaterialPlayer } from "./MaterialPlayer.js";
import { QuestionAnalyticsPanel } from "./QuestionAnalyticsPanel.js";
import { ReviewPanel } from "./ReviewPanel.js";

type TeacherTab = "progress" | "analytics" | "review" | "grading";
const TEACHER_TABS: [TeacherTab, string][] = [
  ["progress", "Прогресс"],
  ["analytics", "Аналитика"],
  ["review", "Разбор"],
  ["grading", "Проверка"],
];

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
  const [tab, setTab] = useState<TeacherTab>("progress");
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
            tab={tab}
            onTabChange={setTab}
            onLaunched={(id) => {
              setJustLaunchedId(id);
              setTab("progress");
            }}
            reviewSignal={reviewSignal}
          />
        ) : (
          <StudentActivityView activityId={activityId} />
        ))}
    </div>
  );
}

function TeacherActivityView({
  lessonId,
  activityId,
  tab,
  onTabChange,
  onLaunched,
  reviewSignal,
}: {
  lessonId: string;
  activityId: string | null;
  tab: TeacherTab;
  onTabChange: (tab: TeacherTab) => void;
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

      {activityId && (
        <>
          <nav className="flex gap-2 border-b text-xs">
            {TEACHER_TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => onTabChange(key)}
                className={`border-b-2 px-2 py-1 ${tab === key ? "border-slate-900 font-medium" : "border-transparent text-slate-400"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === "progress" && <ClassProgressPanel activityId={activityId} />}
          {tab === "analytics" && <QuestionAnalyticsPanel activityId={activityId} />}
          {tab === "review" && <ReviewPanel key={`${activityId}:${reviewSignal}`} activityId={activityId} isTeacher />}
          {tab === "grading" && <GradingQueue />}
        </>
      )}
    </div>
  );
}

function StudentActivityView({ activityId }: { activityId: string | null }) {
  const [activity, setActivity] = useState<MyActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActivity(null);
    setError(null);
    if (!activityId) return;
    let cancelled = false;
    getMyActivity(activityId)
      .then((data) => !cancelled && setActivity(data))
      .catch(() => !cancelled && setError("Не удалось загрузить задание"));
    return () => {
      cancelled = true;
    };
  }, [activityId]);

  if (!activityId) return <p className="text-xs text-slate-400">Учитель ещё не выдавал задание</p>;
  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!activity) return <p className="text-xs text-slate-400">Загрузка задания…</p>;

  return <MaterialPlayer activity={activity} autosaveActivityId={activityId} />;
}
