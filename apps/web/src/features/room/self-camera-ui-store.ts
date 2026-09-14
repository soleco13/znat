import { create } from "zustand";

interface SelfCameraUiState {
  /**
   * Что попросил пользователь последним нажатием кнопки — а не то, что уже
   * реально включено в LiveKit (`localParticipant.isCameraEnabled`, который
   * подтверждается только после `getUserMedia`/публикации трека). Кнопка и
   * плитка в `RoomVideoGrid` рисуются по ЭТОМУ полю, поэтому выключение
   * камеры на экране происходит мгновенно по клику, не дожидаясь, пока
   * трек реально отпубликуется/остановится под капотом.
   */
  desiredOn: boolean;
  /**
   * Пришёл ли от `<video>` реальный первый кадр после включения. Пока
   * `desiredOn=true`, а кадра ещё нет — плитка показывает лоадер вместо
   * чёрного экрана (получение потока с камеры может занять время: сама
   * `getUserMedia`, прогрев сенсора камеры, первый декодированный кадр).
   */
  frameReady: boolean;
  setDesiredOn: (on: boolean) => void;
  setFrameReady: (ready: boolean) => void;
}

export const useSelfCameraUiStore = create<SelfCameraUiState>((set) => ({
  desiredOn: false,
  frameReady: false,
  setDesiredOn: (on) =>
    // Выключение обнуляет frameReady — следующему включению снова нужен
    // свой первый кадр. При включении frameReady не трогаем: оно и так уже
    // false после предыдущего выключения, а иначе (событие «включилось»
    // прилетело ПОСЛЕ первого кадра) мы бы затирали уже готовый кадр и
    // возвращали лоадер обратно.
    set(on ? { desiredOn: true } : { desiredOn: false, frameReady: false }),
  setFrameReady: (ready) => set({ frameReady: ready }),
}));
