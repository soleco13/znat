import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { LessonResponse } from "@school/shared";
import { apiFetch } from "../../shared/api-client.js";

export function LessonsListPage() {
  const [lessons, setLessons] = useState<LessonResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ items: LessonResponse[] }>("/lessons")
      .then((data) => setLessons(data.items))
      .catch(() => setError("Не удалось загрузить список уроков"));
  }, []);

  return (
    <div className="mx-auto mt-12 max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">Уроки</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!lessons && !error && <p>Загрузка…</p>}
      {lessons?.length === 0 && <p className="text-slate-500">Уроков пока нет.</p>}
      <ul className="flex flex-col gap-2">
        {lessons?.map((lesson) => (
          <li key={lesson.id} className="flex items-center justify-between rounded border px-3 py-2">
            <div>
              <div className="font-medium">{lesson.title}</div>
              <div className="text-sm text-slate-500">
                {lesson.subject} · {new Date(lesson.startsAt).toLocaleString("ru-RU")} · {lesson.status}
              </div>
            </div>
            {(lesson.status === "scheduled" || lesson.status === "live") && (
              <Link to={`/lessons/${lesson.id}/room`} className="rounded border px-3 py-1 text-sm">
                Войти
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
