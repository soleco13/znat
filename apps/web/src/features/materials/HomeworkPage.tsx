import { useEffect, useState } from "react";
import type { ActivityDto, GroupResponse } from "@school/shared";
import { useAuthStore } from "../../shared/auth-store.js";
import { assignHomework, listGroupActivities, listMyGroups } from "./activity-api.js";
import { ActivityPlayer } from "./ActivityPlayer.js";
import { ActivityTeacherTabs } from "./ActivityTeacherTabs.js";

/**
 * Экран «Мои домашние задания» (Э8.11) — вход в режим `homework` ВНЕ урока,
 * зафиксированный как сознательно не сделанный при подключении Э8.4–8.12 к
 * `RoomPage` (см. `docs/CURRENT_STAGE.md`, «Подключение к экрану урока»).
 * Backend (`GET /groups/:id/activities`, `POST /groups/:id/activities`)
 * готов с Э8.11 — не хватало только точки входа "какую группу спрашивать",
 * которую закрывает новый `GET /users/me/groups` (см. `listMyGroups` в
 * `apps/api/src/modules/users/service.ts`).
 *
 * Роль решает вид, как и везде в проекте (`RoomPage.isTeacher`):
 * teacher/admin — назначают домашку и видят учительские вкладки
 * (`ActivityTeacherTabs`, переиспользован из `LessonActivityPanel`);
 * student — видит список выданного и открывает плеер (`ActivityPlayer`).
 * `methodist` не участвует ни в уроках, ни в домашке (Э8/Э9 — не её роль
 * в этой модели) — намеренно не роутится ни в одну ветку.
 */
export function HomeworkPage() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;

  const canManage = user.role === "teacher" || user.role === "admin";

  return (
    <div className="mx-auto mt-12 max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">Домашние задания</h1>
      {canManage ? (
        <TeacherHomework />
      ) : user.role === "student" ? (
        <StudentHomework />
      ) : (
        <p className="text-slate-500">Недоступно для роли «{user.role}».</p>
      )}
    </div>
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
          groups.items.map((g) => listGroupActivities(g.id).catch(() => ({ items: [] as ActivityDto[] }))),
        );
        if (cancelled) return;
        const all = lists.flatMap((l) => l.items).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setItems(all);
      })
      .catch(() => !cancelled && setError("Не удалось загрузить домашние задания"));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!items) return <p>Загрузка…</p>;
  if (items.length === 0) return <p className="text-slate-500">Домашних заданий пока нет.</p>;

  return (
    <ul className="flex flex-col gap-2">
      {items.map((a) => (
        <li key={a.id} className="rounded border px-3 py-2">
          <button
            onClick={() => setOpenId(openId === a.id ? null : a.id)}
            className="flex w-full items-center justify-between gap-2 text-left text-sm"
          >
            <span>
              Материал {a.materialId.slice(0, 8)}… · выдано {new Date(a.createdAt).toLocaleString("ru-RU")}
              {a.deadline && <> · до {new Date(a.deadline).toLocaleString("ru-RU")}</>}
            </span>
            <span className="shrink-0 text-xs text-slate-400">
              {a.reviewedAt ? "разобрано · " : ""}
              {openId === a.id ? "свернуть" : "открыть"}
            </span>
          </button>
          {openId === a.id && (
            <div className="mt-3 border-t pt-3">
              <ActivityPlayer activityId={a.id} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function TeacherHomework() {
  const [groups, setGroups] = useState<GroupResponse[] | null>(null);
  const [groupId, setGroupId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMyGroups()
      .then((data) => {
        setGroups(data.items);
        const first = data.items[0];
        if (first) setGroupId(first.id);
      })
      .catch(() => setError("Не удалось загрузить список групп"));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!groups) return <p>Загрузка…</p>;
  if (groups.length === 0) return <p className="text-slate-500">В школе пока нет групп.</p>;

  return (
    <div className="space-y-4">
      <label className="block text-sm text-slate-600">
        Группа
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="ml-2 rounded border px-2 py-1 text-sm"
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.grade} класс, {g.academicYear})
            </option>
          ))}
        </select>
      </label>
      {groupId && <GroupHomework key={groupId} groupId={groupId} />}
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
  const [assignError, setAssignError] = useState<string | null>(null);

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
    setAssignError(null);
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
    } catch {
      setAssignError("Не удалось задать домашнюю работу — проверьте id материала");
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Редактора материалов ещё нет (Э9) — id материала так же, как в LessonActivityPanel. */}
      <form onSubmit={handleAssign} className="flex flex-wrap items-end gap-2">
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
          disabled={assigning}
          className="rounded border bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-40"
        >
          {assigning ? "Задаём…" : "Задать на дом"}
        </button>
      </form>
      {assignError && <p className="text-xs text-red-600">{assignError}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {!items && !error && <p className="text-xs text-slate-400">Загрузка…</p>}
      {items?.length === 0 && <p className="text-xs text-slate-400">Домашних заданий этой группе ещё не задавали.</p>}
      <ul className="flex flex-col gap-2">
        {items?.map((a) => (
          <li key={a.id} className="rounded border px-3 py-2">
            <button
              onClick={() => setOpenId(openId === a.id ? null : a.id)}
              className="flex w-full items-center justify-between text-left text-sm"
            >
              <span>
                Материал {a.materialId.slice(0, 8)}… · выдано {new Date(a.createdAt).toLocaleString("ru-RU")}
              </span>
              <span className="text-xs text-slate-400">{openId === a.id ? "свернуть" : "открыть"}</span>
            </button>
            {openId === a.id && (
              <div className="mt-3 border-t pt-3">
                <ActivityTeacherTabs activityId={a.id} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
