import { useCallback, useEffect, useRef, useState } from "react";
import type { AnnotationStroke } from "@school/shared";

import type { AutosaveStatus } from "./useActivityAutosave.js";
import { getMyAnnotations, getStudentAnnotations, saveStudentAnnotations } from "./annotations-api.js";
import { onAnnotationsUpdated } from "./annotations-events.js";

/**
 * Страховочный опрос на случай пропущенного WS-события (сокет
 * переподключался). Основной путь — пуш `annotations_updated`: раньше
 * каждый ученик опрашивал раз в 3 с, ~10 запросов в секунду на класс.
 */
const FALLBACK_POLL_MS = 30_000;
/** Пауза после последнего штриха перед автосохранением у учителя. */
const SAVE_DEBOUNCE_MS = 1_500;

/**
 * Ученик: пометки учителя поверх его материала (read-only, пуш + редкий опрос).
 * `enabled=false` держит опрос выключенным (материал не на экране).
 */
export function useStudentAnnotationsPoll(activityId: string, enabled: boolean): AnnotationStroke[] {
  const [strokes, setStrokes] = useState<AnnotationStroke[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () =>
      getMyAnnotations(activityId)
        .then((r) => !cancelled && setStrokes(r.strokes))
        .catch(() => undefined);
    void load();
    const t = setInterval(() => void load(), FALLBACK_POLL_MS);
    const unsubscribe = onAnnotationsUpdated((updatedActivityId) => {
      if (updatedActivityId === activityId) void load();
    });
    return () => {
      cancelled = true;
      clearInterval(t);
      unsubscribe();
    };
  }, [activityId, enabled]);

  return strokes;
}

/**
 * Учитель: редактируемые пометки конкретному ученику. Грузятся один раз,
 * сохраняются с debounce после каждого изменения (`onChange` слоя).
 */
export function useEditableAnnotations(
  activityId: string,
  participantId: string,
): {
  strokes: AnnotationStroke[];
  setStrokes: (next: AnnotationStroke[]) => void;
  status: AutosaveStatus;
  loaded: boolean;
} {
  const [strokes, setStrokesState] = useState<AnnotationStroke[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<AnnotationStroke[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    getStudentAnnotations(activityId, participantId)
      .then((r) => {
        if (cancelled) return;
        setStrokesState(r.strokes);
        latest.current = r.strokes;
        setLoaded(true);
      })
      .catch(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [activityId, participantId]);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setStatus("saving");
    try {
      await saveStudentAnnotations(activityId, participantId, { strokes: latest.current });
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }, [activityId, participantId]);

  const setStrokes = useCallback(
    (next: AnnotationStroke[]) => {
      setStrokesState(next);
      latest.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // Досохранить несохранённое при уходе (закрыл разметку / свернул стейдж).
  useEffect(() => {
    return () => {
      if (timer.current) void flush();
    };
  }, [flush]);

  return { strokes, setStrokes, status, loaded };
}
