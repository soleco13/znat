import {
  disconnectCanvasParticipant,
  getActiveCanvasDocumentsCount,
  getCanvasDocumentsWithPendingUpdatesCount,
  getRejectedReadOnlyUpdatesCount,
  hocuspocus,
  postAnswerToBoard,
  setDrawPermission,
  setDrawPermissionResolver,
  startCanvasUnloadSweep,
  stopCanvasUnloadSweep,
} from "./hocuspocus.js";

/**
 * Финальный снимок при закрытии урока (Э3.2, §3.4 ТЗ). Закрывает все
 * `/collab`-подключения к Y.Doc этого урока в Hocuspocus — штатный
 * `onClose`-путь пакета сохраняет дебаунсированные изменения немедленно
 * (`unloadImmediately: true`, см. canvas/hocuspocus.ts), гарантируя, что
 * снимок не потеряется. Сам документ из памяти при этом сразу не
 * выгружается — после Э3.3 выгрузка ЛЮБОГО опустевшего документа (в т.ч.
 * из-за конца урока) проходит через тот же 5-минутный грейс-период и
 * периодический sweep, что и обычный уход последнего участника; отдельный
 * путь «выгрузить немедленно, раз урок закончился» не заводился —
 * усложнение не даёт ничего, кроме чуть более раннего освобождения
 * нескольких мегабайт RAM.
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

export {
  disconnectCanvasParticipant,
  getActiveCanvasDocumentsCount,
  getCanvasDocumentsWithPendingUpdatesCount,
  getRejectedReadOnlyUpdatesCount,
  postAnswerToBoard,
  setDrawPermission,
  setDrawPermissionResolver,
  startCanvasUnloadSweep,
  stopCanvasUnloadSweep,
};
