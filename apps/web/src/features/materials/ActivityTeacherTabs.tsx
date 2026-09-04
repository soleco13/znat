import { useState } from "react";
import { ClassProgressPanel } from "./ClassProgressPanel.js";
import { GradingQueue } from "./GradingQueue.js";
import { QuestionAnalyticsPanel } from "./QuestionAnalyticsPanel.js";
import { ReviewPanel } from "./ReviewPanel.js";

type Tab = "progress" | "analytics" | "review" | "grading";
const TABS: [Tab, string][] = [
  ["progress", "Прогресс"],
  ["analytics", "Аналитика"],
  ["review", "Разбор"],
  ["grading", "Проверка"],
];

/**
 * Учительские вкладки по одной выданной активности (Прогресс/Аналитика/
 * Разбор/Проверка) — общие для выдачи в уроке (Э8.6, `LessonActivityPanel`)
 * и домашней работы (Э8.11, `HomeworkPage`). Выделено сюда при подключении
 * экрана «Мои домашние задания», чтобы не дублировать код вкладок во втором
 * месте — сами панели (`ClassProgressPanel`/…) не изменились.
 *
 * Вкладка сбрасывается на «Прогресс» при смене `activityId` через `key` у
 * родителя (см. использования) — сознательно не через `useEffect` здесь.
 */
export function ActivityTeacherTabs({ activityId, reviewSignal = 0 }: { activityId: string; reviewSignal?: number }) {
  const [tab, setTab] = useState<Tab>("progress");
  return (
    <div className="space-y-3">
      <nav className="flex gap-2 border-b text-xs">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
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
    </div>
  );
}
