import { useEffect, useMemo, useRef, useState } from "react";
import type { ParticipantSnapshot } from "@school/shared";

/** Обрыв короче — плитка без изменений: переподключение канала урока на мобильной сети занимает 1–2 с. */
export const RECONNECT_BADGE_AFTER_MS = 3_000;
/**
 * Дольше — участника больше не показываем «в уроке». Покрывает F5 (вход заново
 * за 3–8 с) и переподключение канала после короткого обрыва (бэкофф клиента
 * до 16 с). Закрытая вкладка исчезает через это время, а не висит
 * «Переподключение…»; настоящий выход (`/leave`) убирает плитку сразу —
 * сервер присылает `participant_left`, участника нет в списке вовсе.
 */
export const RECONNECT_GRACE_MS = 15_000;

export interface PresenceView {
  /** Участники для показа: в пределах grace — всё ещё `connected: true`. */
  participants: ParticipantSnapshot[];
  /** Связь потеряна дольше `RECONNECT_BADGE_AFTER_MS`, но grace не истёк — «Переподключение…». */
  reconnectingIds: ReadonlySet<string>;
}

/**
 * Сервер отмечает `connected: false` сразу, как закрылся сокет канала урока.
 * Сетка раньше в тот же миг убирала плитку и перестраивалась, а через 1–2 с
 * плитка возвращалась — со стороны это выглядело как «ученик пропал»
 * (нагрузочный тест 2026-10-05: после обрыва сети класса так «моргнули» 4 из
 * 30). Здесь короткий разрыв не меняет ни состав сетки, ни позиции плиток;
 * отсчёт идёт от момента, когда клиент увидел переход `connected → false`.
 */
export function usePresenceGrace(participants: ParticipantSnapshot[]): PresenceView {
  const lostAt = useRef(new Map<string, number>());
  const wasConnected = useRef(new Map<string, boolean>());
  const [now, setNow] = useState(() => Date.now());

  // Переходы считаем при рендере: состояние нужно уже в этом кадре, иначе
  // плитка успела бы исчезнуть на один кадр.
  const t = Date.now();
  const seen = new Set<string>();
  for (const p of participants) {
    seen.add(p.userId);
    const before = wasConnected.current.get(p.userId);
    if (p.connected) lostAt.current.delete(p.userId);
    else if (before === true && !lostAt.current.has(p.userId)) lostAt.current.set(p.userId, t);
    wasConnected.current.set(p.userId, p.connected);
  }
  for (const id of [...wasConnected.current.keys()]) {
    if (!seen.has(id)) {
      wasConnected.current.delete(id);
      lostAt.current.delete(id);
    }
  }

  // Следующая граница (появление метки или конец grace) — перерисовать в этот момент.
  let nextAt = Infinity;
  for (const at of lostAt.current.values()) {
    for (const edge of [at + RECONNECT_BADGE_AFTER_MS, at + RECONNECT_GRACE_MS]) if (edge > t) nextAt = Math.min(nextAt, edge);
  }
  useEffect(() => {
    if (nextAt === Infinity) return;
    const timer = setTimeout(() => setNow(Date.now()), nextAt - Date.now() + 20);
    return () => clearTimeout(timer);
  }, [nextAt]);

  const lostKey = [...lostAt.current].map(([id, at]) => `${id}:${at}`).join(",");
  return useMemo(() => {
    const clock = Math.max(now, Date.now());
    const reconnectingIds = new Set<string>();
    const view = participants.map((p) => {
      const at = lostAt.current.get(p.userId);
      if (p.connected || at === undefined) return p;
      const lost = clock - at;
      if (lost >= RECONNECT_GRACE_MS) return p;
      if (lost >= RECONNECT_BADGE_AFTER_MS) reconnectingIds.add(p.userId);
      return { ...p, connected: true };
    });
    return { participants: view, reconnectingIds };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lostKey отражает изменения lostAt
  }, [participants, now, lostKey]);
}
