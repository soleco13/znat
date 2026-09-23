type Listener = (activityId: string) => void;

const listeners = new Set<Listener>();

/** Сигнал из WS урока (`annotations_updated`) в хук пометок ученика — без протаскивания через дерево компонентов. */
export function notifyAnnotationsUpdated(activityId: string): void {
  for (const listener of listeners) listener(activityId);
}

export function onAnnotationsUpdated(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
