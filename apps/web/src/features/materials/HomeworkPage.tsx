import { useEffect, useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import type { ActivityDto, GroupResponse } from "@school/shared";

import { cn } from "@/lib/utils";
import { useAuthStore } from "@/shared/auth-store";
import { useAsync } from "@/shared/hooks/use-async";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { ErrorState } from "@/shared/ui/error-state";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { PageHeader } from "@/shared/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/sonner";
import { assignHomework, listGroupActivities, listMyGroups } from "./activity-api.js";
import { ActivityPlayer } from "./ActivityPlayer.js";
import { ActivityTeacherTabs } from "./ActivityTeacherTabs.js";

/**
 * Экран «Мои домашние задания» (Э8.11). Роль решает вид:
 * teacher/admin — назначают домашку и видят учительские вкладки;
 * student — видит список выданного и открывает плеер;
 * methodist — намеренно не роутится ни в одну ветку.
 */
export function HomeworkPage() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;

  const canManage = user.role === "teacher" || user.role === "admin";

  return (
    <div>
      <PageHeader title="Домашние задания" subtitle="Задания вне урока" />
      {canManage ? (
        <TeacherHomework />
      ) : user.role === "student" ? (
        <StudentHomework />
      ) : (
        <EmptyState icon={BookOpen} title={`Недоступно для роли «${user.role}»`} />
      )}
    </div>
  );
}

function ActivityRow({
  activity,
  open,
  onToggle,
  children,
}: {
  activity: ActivityDto;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0 text-sm">
          <span className="font-medium text-foreground">Материал {activity.materialId.slice(0, 8)}…</span>
          <span className="text-muted-foreground">
            {" · выдано "}
            {new Date(activity.createdAt).toLocaleString("ru-RU")}
            {activity.deadline ? ` · до ${new Date(activity.deadline).toLocaleString("ru-RU")}` : ""}
            {activity.reviewedAt ? " · разобрано" : ""}
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? <div className="border-t border-border p-4">{children}</div> : null}
    </Card>
  );
}

function StudentHomework() {
  const [items, setItems] = useState<ActivityDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyGroups()
      .then(async (groups) => {
        const lists = await Promise.all(
          groups.items.map((g) =>
            listGroupActivities(g.id).catch(() => ({ items: [] as ActivityDto[] })),
          ),
        );
        if (cancelled) return;
        const all = lists
          .flatMap((l) => l.items)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setItems(all);
      })
      .catch(() => !cancelled && setError("Не удалось загрузить домашние задания"));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorState description={error} />;
  if (!items) return <ListSkeleton />;
  if (items.length === 0)
    return <EmptyState icon={BookOpen} title="Домашних заданий пока нет" />;

  return (
    <div className="flex flex-col gap-2.5">
      {items.map((a) => (
        <ActivityRow
          key={a.id}
          activity={a}
          open={openId === a.id}
          onToggle={() => setOpenId(openId === a.id ? null : a.id)}
        >
          <ActivityPlayer activityId={a.id} />
        </ActivityRow>
      ))}
    </div>
  );
}

function TeacherHomework() {
  const { data, error, loading, reload } = useAsync(() => listMyGroups(), []);
  const [groupId, setGroupId] = useState<string>("");

  useEffect(() => {
    if (data && !groupId && data.items[0]) setGroupId(data.items[0].id);
  }, [data, groupId]);

  if (loading) return <ListSkeleton />;
  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (!data || data.items.length === 0)
    return <EmptyState icon={BookOpen} title="В школе пока нет групп" />;

  return (
    <div className="space-y-5">
      <div className="flex max-w-xs flex-col gap-1.5">
        <Label htmlFor="hw-group">Группа</Label>
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger id="hw-group">
            <SelectValue placeholder="Выберите группу" />
          </SelectTrigger>
          <SelectContent>
            {data.items.map((g: GroupResponse) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name} ({g.grade} класс, {g.academicYear})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {groupId ? <GroupHomework key={groupId} groupId={groupId} /> : null}
    </div>
  );
}

function GroupHomework({ groupId }: { groupId: string }) {
  const [items, setItems] = useState<ActivityDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [materialId, setMaterialId] = useState("");
  const [timerSeconds, setTimerSeconds] = useState("");
  const [assigning, setAssigning] = useState(false);

  function load() {
    listGroupActivities(groupId)
      .then((data) => setItems([...data.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))))
      .catch(() => setError("Не удалось загрузить домашние задания группы"));
  }

  useEffect(() => {
    setItems(null);
    setError(null);
    setOpenId(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!materialId.trim()) return;
    setAssigning(true);
    try {
      const dto = await assignHomework(groupId, {
        materialId: materialId.trim(),
        mode: "homework",
        timerSeconds: timerSeconds.trim() ? Number(timerSeconds) : undefined,
      });
      setMaterialId("");
      setTimerSeconds("");
      setOpenId(dto.id);
      load();
      toast.success("Домашняя работа задана");
    } catch {
      toast.error("Не удалось задать домашнюю работу — проверьте id материала");
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        {/* Редактора материалов ещё нет (Э9) — id материала как в LessonActivityPanel. */}
        <form onSubmit={handleAssign} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hw-material" className="text-xs">id материала</Label>
            <Input
              id="hw-material"
              value={materialId}
              onChange={(e) => setMaterialId(e.target.value)}
              placeholder="uuid материала"
              className="w-64"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hw-timer" className="text-xs">таймер, сек</Label>
            <Input
              id="hw-timer"
              inputMode="numeric"
              value={timerSeconds}
              onChange={(e) => setTimerSeconds(e.target.value)}
              placeholder="600"
              className="w-28"
            />
          </div>
          <Button type="submit" loading={assigning}>
            {assigning ? "Задаём…" : "Задать на дом"}
          </Button>
        </form>
      </Card>

      {error ? <ErrorState description={error} /> : null}
      {!items && !error ? <ListSkeleton /> : null}
      {items && items.length === 0 ? (
        <EmptyState icon={BookOpen} title="Этой группе ещё не задавали домашних заданий" />
      ) : null}

      <div className="flex flex-col gap-2.5">
        {items?.map((a) => (
          <ActivityRow
            key={a.id}
            activity={a}
            open={openId === a.id}
            onToggle={() => setOpenId(openId === a.id ? null : a.id)}
          >
            <ActivityTeacherTabs activityId={a.id} />
          </ActivityRow>
        ))}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}
