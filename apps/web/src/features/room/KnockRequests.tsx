import { useCallback, useEffect, useState } from "react";
import { DoorOpen, UsersRound } from "lucide-react";
import type { LessonKnock, LessonKnocksResponse } from "@school/shared";

import { apiFetch } from "@/shared/api-client";
import { notify } from "@/shared/ui/notify";

/** Пока вход закрыт — опрос списка (запрос пропадает, когда ученик закрыл страницу). */
const POLL_MS = 4_000;
const NOTICE_ID = "knock";

/**
 * Комната ожидания (2026-10-17): вход закрыт, ученик просит войти — учителю,
 * админу или соведущему уведомление «Имя просит войти» с «Впустить» и
 * «Отклонить», при нескольких — «Просят войти: N» с «Впустить всех» и
 * «По одному». Висит, пока запросы не решены. Появляется по сигналу канала урока
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

  const decide = useCallback(
    async (path: string) => {
      try {
        await apiFetch(`/lessons/${lessonId}/knocks/${path}`, { method: "POST" });
      } catch {
        // Запрос мог уже исчезнуть (ученик ушёл) — список обновится ниже.
      } finally {
        void load();
      }
    },
    [lessonId, load],
  );

  // Одно уведомление на все запросы: один — «Впустить»/«Отклонить»;
  // несколько — «Впустить всех» или «По одному» (тогда — по старшинству).
  const [oneByOne, setOneByOne] = useState(false);
  useEffect(() => {
    if (knocks.length === 0) {
      setOneByOne(false);
      notify.dismiss(NOTICE_ID);
      return;
    }
    const first = knocks[0]!;
    if (knocks.length === 1 || oneByOne) {
      notify(first.name, {
        id: NOTICE_ID,
        icon: DoorOpen,
        text: knocks.length > 1 ? `Просит войти. Ещё ждут: ${knocks.length - 1}` : "Просит войти в урок",
        duration: Infinity,
        actions: [
          { label: "Впустить", primary: true, onClick: () => void decide(`${first.id}/admit`) },
          { label: "Отклонить", onClick: () => void decide(`${first.id}/deny`) },
        ],
      });
      return;
    }
    notify(`Просят войти: ${knocks.length}`, {
      id: NOTICE_ID,
      icon: UsersRound,
      text: knocks.map((k) => k.name).join(", "),
      duration: Infinity,
      actions: [
        { label: "Впустить всех", primary: true, onClick: () => void decide("admit-all") },
        { label: "По одному", keepOpen: true, onClick: () => setOneByOne(true) },
      ],
    });
  }, [knocks, oneByOne, decide]);

  // Ушли из урока — запрос с экрана снять.
  useEffect(() => () => notify.dismiss(NOTICE_ID), []);

  return null;
}
