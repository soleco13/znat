import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { ActivityStudentAttempt, MaterialBlock, QuestionResponse } from "@school/shared";
import { stripMaterialAnswerKeys } from "@school/shared";

import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { ActivityPlayer } from "../materials/ActivityPlayer.js";
import { ActivityTeacherTabs } from "../materials/ActivityTeacherTabs.js";
import { ContentBlockView } from "../materials/MaterialPlayer.js";
import { QuestionPlayer } from "../materials/QuestionPlayer.js";
import { getStudentAttempt } from "../materials/activity-api.js";
import { formatCorrectAnswer, formatResponse } from "../materials/answer-format.js";

/**
 * Выданное задание на стейдже урока (§7.3 ТЗ, Э12.7 «RoomStage — режим
 * материал»). Ученик решает свою копию; учитель/админ видит прогресс класса
 * и по клику открывает материал конкретного ученика — что тот выбрал и ввёл
 * прямо сейчас (живой опрос). Плитки камер в это время уходят в ленту
 * (см. `RoomPage`), как при открытой доске.
 */
export function ActivityStage({
  activityId,
  isTeacher,
  reviewSignal = 0,
  onClose,
}: {
  activityId: string;
  isTeacher: boolean;
  reviewSignal?: number;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {isTeacher ? (
        <TeacherActivityStage
          activityId={activityId}
          reviewSignal={reviewSignal}
          onClose={onClose}
        />
      ) : (
        <>
          <StageHeader title="Задание" onClose={onClose} />
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto max-w-[720px] p-4">
              <ActivityPlayer activityId={activityId} />
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}

function StageHeader({
  title,
  onClose,
  left,
}: {
  title: string;
  onClose?: () => void;
  left?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {left}
        <span className="truncate text-sm font-heavy text-foreground">{title}</span>
      </div>
      {onClose ? (
        <Button variant="ghost" size="sm" onClick={onClose}>
          Свернуть
        </Button>
      ) : null}
    </div>
  );
}

function TeacherActivityStage({
  activityId,
  reviewSignal,
  onClose,
}: {
  activityId: string;
  reviewSignal: number;
  onClose?: () => void;
}) {
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);

  if (selected) {
    return (
      <>
        <StageHeader
          title={selected.name}
          onClose={onClose}
          left={
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              <ArrowLeft aria-hidden />К классу
            </Button>
          }
        />
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto max-w-[720px] p-4">
            <StudentAttemptView activityId={activityId} participantId={selected.id} />
          </div>
        </ScrollArea>
      </>
    );
  }

  return (
    <>
      <StageHeader title="Задание — класс" onClose={onClose} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-[760px] p-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Во вкладке «Прогресс» нажмите на ученика — откроется его материал с текущими ответами.
          </p>
          <ActivityTeacherTabs
            key={activityId}
            activityId={activityId}
            reviewSignal={reviewSignal}
            onSelectStudent={(id, name) => setSelected({ id, name })}
          />
        </div>
      </ScrollArea>
    </>
  );
}

/** Как часто учитель перезапрашивает работу открытого ученика — тот отвечает в реальном времени. */
const ATTEMPT_POLL_MS = 5_000;

function StudentAttemptView({
  activityId,
  participantId,
}: {
  activityId: string;
  participantId: string;
}) {
  const [attempt, setAttempt] = useState<ActivityStudentAttempt | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAttempt(null);
    setError(false);
    const load = () =>
      getStudentAttempt(activityId, participantId)
        .then((d) => !cancelled && setAttempt(d))
        .catch(() => !cancelled && setError(true));
    void load();
    const t = setInterval(() => void load(), ATTEMPT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [activityId, participantId]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Не удалось загрузить работу ученика</AlertDescription>
      </Alert>
    );
  }
  if (!attempt) return <CenteredSpinner label="Загрузка работы…" />;

  const publicMaterial = stripMaterialAnswerKeys(attempt.material, `teacher:${participantId}`);
  const questionById = new Map<string, MaterialBlock>(
    attempt.material.blocks.filter((b) => b.type === "question").map((b) => [b.id, b]),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Ответов: {attempt.answered}/{attempt.total}
        </span>
        {attempt.submittedAt ? (
          <Badge variant="green">сдано</Badge>
        ) : (
          <Badge variant="gray">в работе</Badge>
        )}
        {attempt.lastActivityAt ? (
          <span>изменено {new Date(attempt.lastActivityAt).toLocaleTimeString("ru-RU")}</span>
        ) : null}
      </div>

      {publicMaterial.blocks.map((block) =>
        block.type === "question" ? (
          <div key={block.id} className="space-y-1.5">
            <QuestionPlayer
              block={block}
              value={attempt.responses[block.id]}
              onChange={() => undefined}
              disabled
            />
            <StudentAnswerLine
              full={questionById.get(block.id)}
              response={attempt.responses[block.id]}
            />
          </div>
        ) : (
          <ContentBlockView key={block.id} block={block} />
        ),
      )}
    </div>
  );
}

function StudentAnswerLine({
  full,
  response,
}: {
  full: MaterialBlock | undefined;
  response: QuestionResponse | undefined;
}) {
  if (!full || full.type !== "question") return null;
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-secondary/50 p-2.5 text-sm sm:grid-cols-2">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-text-3">Ответ ученика</p>
        <p className="font-semibold text-foreground">
          {formatResponse(full.interaction, response)}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-text-3">Верный ответ</p>
        <p className="font-medium text-success">{formatCorrectAnswer(full.interaction)}</p>
      </div>
    </div>
  );
}
