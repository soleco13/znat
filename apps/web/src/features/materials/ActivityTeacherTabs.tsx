import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { ClassProgressPanel } from "./ClassProgressPanel.js";
import { GradingQueue } from "./GradingQueue.js";
import { QuestionAnalyticsPanel } from "./QuestionAnalyticsPanel.js";
import { ReviewPanel } from "./ReviewPanel.js";

/**
 * Учительские вкладки по одной выданной активности (Прогресс/Аналитика/
 * Разбор/Проверка) — общие для выдачи в уроке и домашней работы.
 * Вкладка сбрасывается на «Прогресс» при смене `activityId` через `key` у родителя.
 */
export function ActivityTeacherTabs({
  activityId,
  reviewSignal = 0,
  onSelectStudent,
}: {
  activityId: string;
  reviewSignal?: number;
  /** §7.3 ТЗ: клик по ученику в «Прогрессе» — открыть его материал. */
  onSelectStudent?: (participantId: string, displayName: string) => void;
}) {
  return (
    <Tabs defaultValue="progress" className="space-y-3">
      <TabsList>
        <TabsTrigger value="progress">Прогресс</TabsTrigger>
        <TabsTrigger value="analytics">Аналитика</TabsTrigger>
        <TabsTrigger value="review">Разбор</TabsTrigger>
        <TabsTrigger value="grading">Проверка</TabsTrigger>
      </TabsList>
      <TabsContent value="progress">
        <ClassProgressPanel activityId={activityId} onSelectStudent={onSelectStudent} />
      </TabsContent>
      <TabsContent value="analytics">
        <QuestionAnalyticsPanel activityId={activityId} />
      </TabsContent>
      <TabsContent value="review">
        <ReviewPanel key={`${activityId}:${reviewSignal}`} activityId={activityId} isTeacher />
      </TabsContent>
      <TabsContent value="grading">
        <GradingQueue />
      </TabsContent>
    </Tabs>
  );
}
