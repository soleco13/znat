import type { HocuspocusProvider } from "@hocuspocus/provider";

/**
 * Подключение к доске урока (Y.Doc + HocuspocusProvider), которое переживает
 * размонтирование `<Board>` (UX-аудит 2026-10-13). Учитель переключает экран
 * урока «доска → участники → доска» — раньше доска у всех создавалась заново:
 * документ и провайдер уничтожались, история «Отменить» пропадала, а при
 * возврате доска заново синхронизировалась.
 *
 * Теперь в уроке (`keepAlive`) сессия живёт, пока человек в уроке: `<Board>`
 * берёт её при монтировании и отпускает при размонтировании, уничтожает —
 * `disposeBoardSessions` при выходе из урока. Без `keepAlive` (шаблон записи)
 * — как раньше: уничтожается вместе с доской.
 *
 * Жизненный цикл документа (CLAUDE.md «не делегировать вслепую»):
 *  - `create` вызывается один раз на ключ; его `dispose` уничтожает провайдер
 *    и документ — единственное место, где это происходит;
 *  - `Y.UndoManager` страниц (`board-undo.ts`) подписан на `destroy`
 *    документа (Yjs) и уничтожается вместе с ним, отдельно их не чистим.
 *
 * Модуль без runtime-импорта Yjs: страница урока подключает его напрямую
 * (`disposeBoardSessions`), а Yjs живёт в отдельном чанке доски.
 */
interface BoardSession {
  provider: HocuspocusProvider;
  dispose: () => void;
  refs: number;
}

const sessions = new Map<string, BoardSession>();

export function acquireBoardSession(
  key: string,
  create: () => { provider: HocuspocusProvider; dispose: () => void },
): HocuspocusProvider {
  let session = sessions.get(key);
  if (!session) {
    session = { ...create(), refs: 0 };
    sessions.set(key, session);
  }
  session.refs += 1;
  return session.provider;
}

export function releaseBoardSession(key: string, keepAlive: boolean): void {
  const session = sessions.get(key);
  if (!session) return;
  session.refs -= 1;
  if (session.refs > 0) return;
  if (keepAlive) {
    // Доска скрыта, но человек в уроке: свой курсор у других убираем.
    session.provider.awareness?.setLocalStateField("pointer", null);
    return;
  }
  sessions.delete(key);
  session.dispose();
}

/** Выход из урока — уничтожить все его доски. */
export function disposeBoardSessions(lessonId: string): void {
  for (const [key, session] of sessions) {
    if (!key.startsWith(`${lessonId}|`)) continue;
    sessions.delete(key);
    session.dispose();
  }
}
