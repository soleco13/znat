import { hocuspocus } from "./hocuspocus.js";

/**
 * Финальный снимок при закрытии урока (Э3.2, §3.4 ТЗ). Закрывает все
 * `/collab`-подключения к Y.Doc этого урока в Hocuspocus — штатный
 * `onClose`-путь пакета сам сохраняет debounced-изменения немедленно
 * (`unloadImmediately: true`, см. canvas/hocuspocus.ts) и выгружает
 * документ из памяти, даже если участники ещё не закрыли вкладку сами.
 *
 * Вызывается из rooms/service.ts рядом с каждым вызовом
 * `lessonsService.endLesson()` — НЕ из lessons/service.ts напрямую: canvas
 * уже зависит от lessons (проверка прав в onAuthenticate), и обратная
 * зависимость lessons → canvas создала бы цикл (запрещено
 * dependency-cruiser, §4.1.1 ТЗ). rooms зависит от lessons и не зависит от
 * canvas — безопасная точка интеграции.
 */
export function closeCanvasDocument(lessonId: string): void {
  hocuspocus.closeConnections(lessonId);
}
