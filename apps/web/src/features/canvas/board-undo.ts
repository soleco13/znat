import * as Y from "yjs";

/**
 * `Y.UndoManager` страницы — один на её `Y.Array`, переживает пересоздание
 * привязки (смена стейджа, права рисовать). Уничтожается вместе с документом.
 */
const undoManagers = new WeakMap<Y.Array<unknown>, Y.UndoManager>();

export function undoManagerFor(yElements: Y.Array<Y.Map<unknown>>): Y.UndoManager {
  let manager = undoManagers.get(yElements as Y.Array<unknown>);
  if (!manager) {
    manager = new Y.UndoManager(yElements, { trackedOrigins: new Set<unknown>() });
    undoManagers.set(yElements as Y.Array<unknown>, manager);
  }
  return manager;
}
