import { useCallback, useEffect, useState } from "react";
import { DoorOpen } from "lucide-react";
import type { LessonKnock, LessonKnocksResponse } from "@school/shared";

import { apiFetch } from "@/shared/api-client";
import { Button } from "@/shared/ui/button";

/** Пока вход закрыт — опрос списка (запрос пропадает, когда ученик закрыл страницу). */
const POLL_MS = 4_000;
/** Сколько имён показать на плашке; остальные — «и ещё N». */
const SHOWN = 3;

/**
 * Комната ожидания (2026-10-17): вход закрыт, ученик просит войти — учителю,
 * админу или соведущему плашка «Имя хочет войти» с «Впустить» и «Отклонить»,
 * при нескольких — «Впустить всех». Появляется по сигналу канала урока
 * (`knocks_changed` → `signal`), пока вход закрыт — ещё и опросом: ученик
 * закрыл страницу — его запрос из списка уходит.
 */
export function KnockRequests({
  lessonId,
  entryLocked,
  signal,
}: {
  lessonId: string;
  entryLocked: boolean;
  /** Растёт на каждый `knocks_changed` из канала урока. */
  signal: number;
}) {
  const [knocks, setKnocks] = useState<LessonKnock[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<LessonKnocksResponse>(`/lessons/${lessonId}/knocks`);
      setKnocks(res.knocks);
    } catch {
      // Не загрузилось — следующий опрос или сигнал попробует снова.
    }
  }, [lessonId]);

  useEffect(() => {
    void load();
  }, [load, signal]);

  useEffect(() => {
    if (!entryLocked && knocks.length === 0) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [entryLocked, knocks.length, load]);

  async function decide(path: string, key: string) {
    setBusy(key);
    try {
      await apiFetch(`/lessons/${lessonId}/knocks/${path}`, { method: "POST" });
    } catch {
      // Запрос мог уже исчезнуть (ученик ушёл) — список обновится ниже.
    } finally {
      setBusy(null);
      void load();
    }
  }

  if (knocks.length === 0) return null;
  const shown = knocks.slice(0, SHOWN);
  const rest = knocks.length - shown.length;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-3 z-50 w-[min(420px,calc(100vw-24px))] -translate-x-1/2 rounded-xl border border-border bg-card p-3 shadow-lg"
    >
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <DoorOpen className="size-4 text-primary" aria-hidden />
        {knocks.length === 1 ? "Просит войти в урок" : `Просят войти в урок: ${knocks.length}`}
      </p>
      <ul className="flex flex-col gap-2">
        {shown.map((k) => (
          <li key={k.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{k.name}</span>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void decide(`${k.id}/deny`, k.id)}>
              Отклонить
            </Button>
            <Button size="sm" loading={busy === k.id} disabled={busy !== null} onClick={() => void decide(`${k.id}/admit`, k.id)}>
              Впустить
            </Button>
          </li>
        ))}
      </ul>
      {knocks.length > 1 ? (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
          <span className="text-xs text-muted-foreground">{rest > 0 ? `и ещё ${rest}` : ""}</span>
          <Button size="sm" loading={busy === "all"} disabled={busy !== null} onClick={() => void decide("admit-all", "all")}>
            Впустить всех
          </Button>
        </div>
      ) : null}
    </div>
  );
}
