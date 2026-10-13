import { createContext, useContext, type ReactNode } from "react";
import type { ParticipantSnapshot } from "@school/shared";

/**
 * Кнопка «⋯» на плитке камеры (громкость, права, права учителя). Сетка
 * плиток рисуется во многих местах (стейдж, лента у доски, окно учителя) —
 * меню приходит контекстом, а не пропом через каждое. В окне PiP контекста
 * нет: выпадающее меню открылось бы в главном окне.
 */
export const TileMenuContext = createContext<((participant: ParticipantSnapshot) => ReactNode) | null>(null);

export function useTileMenu() {
  return useContext(TileMenuContext);
}
