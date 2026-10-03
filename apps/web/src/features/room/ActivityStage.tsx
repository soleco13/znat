import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Minimize2, Pencil } from "lucide-react";
import type { ActivityStudentAttempt, MaterialBlock, QuestionResponse } from "@school/shared";
import { stripMaterialAnswerKeys } from "@school/shared";

import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { SimpleTooltip } from "@/shared/ui/tooltip";
import { ActivityPlayer } from "../materials/ActivityPlayer.js";
import { ActivityTeacherTabs } from "../materials/ActivityTeacherTabs.js";
import { TextbookView } from "../materials/textbook/TextbookView.js";
import { MaterialAnnotationLayer } from "../materials/MaterialAnnotationLayer.js";
import { useEditableAnnotations, useStudentAnnotationsPoll } from "../materials/useMaterialAnnotations.js";
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
  if (!isTeacher) return <StudentActivityStage activityId={activityId} onClose={onClose} />;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <TeacherActivityStage activityId={activityId} reviewSignal={reviewSignal} onClose={onClose} />
    </div>
  );
}

/**
 * Ученик решает свою копию задания. Учебник занимает весь стейдж, без рамки
 * и заголовка, как в макете «Учебник ученика»: название урока уже в шапке,
 * «Свернуть» — в панели учебника. Поверх материала — слой пометок учителя
 * (Э13): read-only, `pointer-events: none`, опрашивается раз в 3 сек, чтобы
 * карандашные объяснения учителя появлялись сами, не мешая вводу ответов.
 */
function StudentActivityStage({
  activityId,
  onClose,
}: {
  activityId: string;
  onClose?: () => void;
}) {
  const strokes = useStudentAnnotationsPoll(activityId, true);
  return (
    <ScrollArea className="h-full min-h-0 rounded-xl">
      {/* Ширину не зажимаем: на широкой панели учебник раскрывается
          разворотом. Слой пометок учителя уходит внутрь учебника — на
          каждую страницу свой (см. `TextbookView`). Снизу — место под
          плавающее окно учителя, чтобы оно не закрывало конец страницы. */}
      <div className="pb-24">
        <ActivityPlayer
          activityId={activityId}
          showHead={false}
          annotationOverlay={<MaterialAnnotationLayer strokes={strokes} editable={false} />}
          barEnd={
            onClose ? (
              <SimpleTooltip content="Свернуть задание">
                <button
                  type="button"
                  aria-label="Свернуть задание"
                  onClick={onClose}
                  className="tb-iconbtn tb-iconbtn--muted"
                >
                  <Minimize2 aria-hidden />
                </button>
              </SimpleTooltip>
            ) : undefined
          }
        />
      </div>
    </ScrollArea>
  );
}

function StageHeader({
  title,
  onClose,
  left,
  right,
}: {
  title: string;
  onClose?: () => void;
  left?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {left}
        <span className="truncate text-sm font-heavy text-foreground">{title}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {right}
        {onClose ? (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Свернуть
          </Button>
        ) : null}
      </div>
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
      <SelectedStudentView
        key={selected.id}
        activityId={activityId}
        participantId={selected.id}
        name={selected.name}
        onBack={() => setSelected(null)}
        onClose={onClose}
      />
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

/**
 * Учитель открыл материал конкретного ученика. Режим «Разметка» (Э13):
 * поверх материала — редактируемый слой пометок; пока он включён, опрос
 * работы ученика приостановлен (перерисовка материала сбивала бы рисование),
 * поля ответов ученика перекрыты слоем — учитель помечает, не отвечает.
 */
function SelectedStudentView({
  activityId,
  participantId,
  name,
  onBack,
  onClose,
}: {
  activityId: string;
  participantId: string;
  name: string;
  onBack: () => void;
  onClose?: () => void;
}) {
  const [annotating, setAnnotating] = useState(false);
  const { strokes, setStrokes, status, loaded } = useEditableAnnotations(activityId, participantId);
  // Пока прошлые пометки не загрузились — не даём рисовать: первый штрих
  // затёр бы их (сохраняем весь набор целиком).
  const canEdit = annotating && loaded;

  const overlay = canEdit ? (
    <MaterialAnnotationLayer
      strokes={strokes}
      editable
      onChange={setStrokes}
      onExit={() => setAnnotating(false)}
    />
  ) : strokes.length > 0 ? (
    <MaterialAnnotationLayer strokes={strokes} editable={false} />
  ) : null;

  return (
    <>
      <StageHeader
        title={name}
        onClose={onClose}
        left={
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft aria-hidden />К классу
          </Button>
        }
        right={
          <Button
            variant={annotating ? "secondary" : "outline"}
            size="sm"
            onClick={() => setAnnotating((v) => !v)}
          >
            <Pencil aria-hidden />
            {annotating && !loaded ? "Загрузка…" : annotating && status === "saving" ? "Сохранение…" : "Разметка"}
          </Button>
        }
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-[720px] p-4">
          <StudentAttemptView
            activityId={activityId}
            participantId={participantId}
            paused={annotating}
            overlay={overlay}
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
  paused = false,
  overlay,
}: {
  activityId: string;
  participantId: string;
  /** Э13: пока учитель размечает материал, перерисовку от опроса ставим на паузу. */
  paused?: boolean;
  /** Слой пометок учителя — поверх текущего слайда / всей колонки. */
  overlay?: React.ReactNode;
}) {
  const [attempt, setAttempt] = useState<ActivityStudentAttempt | null>(null);
  const [error, setError] = useState(false);
  // Доп. Э13: слайд, на котором ученик СЕЙЧАС, фиксируем один раз при
  // открытии — дальше учитель листает сам, не «прыгая» за учеником.
  const [openAtBlockId, setOpenAtBlockId] = useState<string | null>(null);
  const openAtSet = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getStudentAttempt(activityId, participantId)
        .then((d) => {
          if (cancelled) return;
          setAttempt(d);
          if (!openAtSet.current) {
            openAtSet.current = true;
            setOpenAtBlockId(d.currentBlockId);
          }
        })
        .catch(() => !cancelled && setError(true));
    void load();
    if (paused) return () => { cancelled = true; };
    const t = setInterval(() => void load(), ATTEMPT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [activityId, participantId, paused]);

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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {attempt.submittedAt ? (
          <Badge variant="green">сдано</Badge>
        ) : (
          <Badge variant="gray">в работе</Badge>
        )}
        {attempt.lastActivityAt ? (
          <span>изменено {new Date(attempt.lastActivityAt).toLocaleTimeString("ru-RU")}</span>
        ) : null}
      </div>
      {/* Тот же учебник, что у ученика: пометки учителя привязаны к блокам
          и ложатся на ту же вёрстку. Строка «ответ / верный ответ» — под
          заданием, видна только учителю. */}
      <TextbookView
        material={publicMaterial}
        responses={attempt.responses}
        disabled
        showHead={false}
        overlay={overlay}
        initialBlockId={openAtBlockId}
        renderAfterTask={(id) => (
          <StudentAnswerLine full={questionById.get(id)} response={attempt.responses[id]} />
        )}
      />
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
    <div className="mt-3 grid gap-2 rounded-lg border border-border bg-secondary/50 p-2.5 text-sm sm:grid-cols-2">
      <div>
        <p className="text-xs font-medium text-text-3">Ответ ученика</p>
        <p className="font-semibold text-foreground">
          {formatResponse(full.interaction, response)}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium text-text-3">Верный ответ</p>
        <p className="font-medium text-success">{formatCorrectAnswer(full.interaction)}</p>
      </div>
    </div>
  );
}
