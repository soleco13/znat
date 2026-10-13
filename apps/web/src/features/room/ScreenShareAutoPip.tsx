import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocalParticipant, useSpeakingParticipants } from "@livekit/components-react";
import { Hand, LogOut, MonitorX } from "lucide-react";
import type { ParticipantSnapshot } from "@school/shared";

import { apiFetch } from "@/shared/api-client";
import { SimpleTooltip } from "@/shared/ui/tooltip";
import { SelfCameraButton } from "./CameraControls.js";
import { RoomControlButton } from "./RoomControlButton.js";
import { RoomVideoGrid } from "./RoomVideoGrid.js";
import { SelfMicButton } from "./MicControls.js";
import { stopOwnScreenShare } from "./screen-share-stop.js";
import { TileMenuContext } from "./tile-menu-context.js";

/**
 * Авто-«картинка в картинке» на время демонстрации экрана — как в Толке.
 * Проверено вживую (shkola10.ktalk.ru): их PiP — это НЕ обычный
 * `<video>.requestPictureInPicture()`, а `window.documentPictureInPicture`
 * (подтверждено через `!!window.documentPictureInPicture.window` в консоли
 * их страницы) — отдельное окно ОС с полноценным DOM внутри: сетка
 * плиток участников (растёт от одной плитки до сетки, как у нас
 * `RoomVideoGrid`) + тулбар с кнопками (рука/микрофон/камера/выйти).
 *
 * Здесь то же самое поведение, СВОИМИ стилями: внутрь PiP-окна через
 * `createPortal` рендерится наш собственный `RoomVideoGrid` + тулбар из
 * той же дизайн-системы, никакой отдельной вёрстки под PiP не пишем.
 * Тулбар — полный набор, как у Толка: рука (только не-учителю, как в
 * основной панели), микрофон, камера, «стоп демонстрации», выйти.
 * В окне всегда две плитки (`PipTiles`): камера показывающего экран и место
 * говорящего — пока в уроке никого нет, одна своя.
 *
 * НЕТ отдельной кнопки в интерфейсе — включается/выключается только вместе
 * с демонстрацией экрана (запрос пользователя). `open()` дёргает
 * `SelfScreenShareButton` из СВОЕГО клик-хендлера сразу после старта
 * демонстрации: `documentPictureInPicture.requestWindow()`, как и
 * `requestPictureInPicture()`, требует свежий user activation — из
 * отдельного эффекта браузер мог бы отказать.
 *
 * Открывается всегда, независимо от того, чем делятся (весь экран/окно/
 * вкладка) — запрос пользователя: PiP должен быть виден и на демонстрации,
 * и в записи урока одинаково, даже если делятся всем экраном (тогда PiP,
 * как и любое окно поверх экрана, тоже попадёт в захват — осознанный выбор).
 */
declare global {
  interface DocumentPictureInPicture extends EventTarget {
    readonly window: Window | null;
    requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  }
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

/**
 * Стартовый (и, за счёт `resize`-лока в `open()`, фактически неизменный)
 * размер PiP-окна: две плитки рядом (показывающий экран + говорящий) и тулбар.
 */
const PIP_WIDTH = 520;
const PIP_HEIGHT = 300;

export interface ScreenShareAutoPipHandle {
  open: () => Promise<void>;
  /** Закрыть PiP-окно сразу же по клику «Стоп» — не ждать обратного круга
   *  через `isScreenShareEnabled` (см. `useEffect` ниже: он тоже закроет,
   *  но событие `LocalTrackUnpublished` от LiveKit-негоциации приходит не
   *  мгновенно, и пользователь видел завёрнутое PiP-окно ещё секунду-две
   *  после нажатия «Стоп» — жалоба пользователя, 2026-09-11). */
  close: () => void;
}

/** Копия стилей главного документа в PiP-окно — у него своё пустое
 *  `<head>`. Тот же приём, что в примерах самого Chrome для Document PiP:
 *  инлайним правила уже загруженных стилей (наш собранный Vite-бандл,
 *  без внешних CDN — CLAUDE.md), без `<link>` и повторной загрузки. */
function copyStylesInto(pipDocument: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      const style = pipDocument.createElement("style");
      style.textContent = css;
      pipDocument.head.appendChild(style);
    } catch {
      // Кросс-доменный лист (у нас такого нет — шрифты/иконки в бандле,
      // но на случай будущего подключения) — обычной ссылкой.
      if (sheet.href) {
        const link = pipDocument.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        pipDocument.head.appendChild(link);
      }
    }
  }
}

export const ScreenShareAutoPip = forwardRef<
  ScreenShareAutoPipHandle,
  {
    participants: ParticipantSnapshot[];
    selfId: string | undefined;
    /** Параметры школы (запрос 2026-09-14, лок демонстрации) — освободить лок сразу по клику «Стоп» из PiP-тулбара, не дожидаясь вебхука. */
    lessonId: string | undefined;
    isTeacher: boolean;
    handRaised: boolean;
    onToggleHand: () => void;
    onLeave: () => void;
  }
>(function ScreenShareAutoPip({ participants, selfId, lessonId, isTeacher, handRaised, onToggleHand, onLeave }, ref) {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const pipWindowRef = useRef<Window | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  async function open() {
    if (pipWindowRef.current || !window.documentPictureInPicture) return;
    let pipWindow: Window;
    try {
      // 340×320 — под квадратную плитку (нужна нормальная высота, не
      // только ширина) плюс тулбар из 5 кнопок с подписями снизу.
      pipWindow = await window.documentPictureInPicture.requestWindow({
        width: PIP_WIDTH,
        height: PIP_HEIGHT,
      });
    } catch {
      // Нет свежего user activation или браузер не поддерживает — тихо
      // пропускаем, демонстрация экрана от этого не зависит (§1.2 ТЗ).
      return;
    }
    // Запрос пользователя — статичный размер окна PiP. Спецификация Document
    // Picture-in-Picture не даёт `resizable: false` (только `width`/`height`
    // как ПОЖЕЛАНИЕ при открытии — проверено по спеке и MDN, платформенного
    // запрета на ручное растягивание нет). Единственный доступный приём —
    // откатывать любую попытку пользователя потянуть за край окна обратно к
    // размеру на момент открытия: слушаем `resize` самого PiP-окна и, если
    // размер изменился, сразу же возвращаем его `resizeTo`.
    const lockedWidth = pipWindow.outerWidth;
    const lockedHeight = pipWindow.outerHeight;
    pipWindow.addEventListener("resize", () => {
      if (pipWindow.outerWidth !== lockedWidth || pipWindow.outerHeight !== lockedHeight) {
        // Без свежего user activation браузер отказывает (NotAllowedError) —
        // например, когда окно меняет размер само при остановке демонстрации.
        try {
          pipWindow.resizeTo(lockedWidth, lockedHeight);
        } catch {
          // размер окна PiP не критичен
        }
      }
    });
    copyStylesInto(pipWindow.document);
    // Без этого `height:100%` в наших классах ниже резолвится в auto —
    // <html>/<body> PiP-документа по умолчанию не имеют явной высоты
    // (Tailwind preflight её не выставляет), контейнер садится по
    // контенту вместо всей площади реального нативного окна, и под ним
    // остаётся пустая нативная область, никак не относящаяся к нашей
    // вёрстке (то самое «пустое место под кнопками»).
    pipWindow.document.documentElement.style.height = "100%";
    pipWindow.document.body.style.height = "100%";
    pipWindow.document.body.style.margin = "0";
    pipWindow.document.body.className = "bg-background";
    const root = pipWindow.document.createElement("div");
    root.className = "flex h-full min-h-0 flex-col items-stretch gap-3 p-3";
    pipWindow.document.body.appendChild(root);
    pipWindowRef.current = pipWindow;
    setContainer(root);
    pipWindow.addEventListener(
      "pagehide",
      () => {
        pipWindowRef.current = null;
        setContainer(null);
      },
      { once: true },
    );
  }

  useImperativeHandle(ref, () => ({ open, close: () => pipWindowRef.current?.close() }));

  // Закрытие — в любую сторону (наша кнопка «Стоп», браузерная панель
  // «Остановить демонстрацию», обрыв трека): не требует user activation,
  // можно реагировать эффектом.
  useEffect(() => {
    if (!isScreenShareEnabled) pipWindowRef.current?.close();
  }, [isScreenShareEnabled]);

  // Выход из урока размонтирует RoomPage (и этот компонент) без гарантии,
  // что браузер сам закроет PiP-окно синхронно с этим — закрываем явно.
  useEffect(() => {
    return () => {
      pipWindowRef.current?.close();
    };
  }, []);

  if (!container) return null;

  return createPortal(
    // Меню плитки (громкость, права) в PiP не показываем: выпадающий список
    // открылся бы в главном окне, а не здесь.
    <TileMenuContext.Provider value={null}>
      <div className="min-h-0 flex-1">
        <PipTiles participants={participants} selfId={selfId} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-border pt-3">
        {!isTeacher ? (
          <RoomControlButton
            tone="action"
            active={handRaised}
            activeIcon={Hand}
            inactiveIcon={Hand}
            activeLabel="Опустить руку"
            inactiveLabel="Поднять руку"
            onToggle={onToggleHand}
            caption="Рука"
          />
        ) : null}
        <SelfMicButton />
        <SelfCameraButton />
        <RoomControlButton
          tone="action"
          active={false}
          activeIcon={MonitorX}
          inactiveIcon={MonitorX}
          activeLabel="Остановить демонстрацию"
          inactiveLabel="Остановить демонстрацию"
          onToggle={() => {
            void stopOwnScreenShare(localParticipant);
            if (lessonId) void apiFetch(`/lessons/${lessonId}/screen-share/release`, { method: "POST" }).catch(() => undefined);
            pipWindowRef.current?.close();
          }}
          caption="Стоп"
        />
        <div className="flex flex-col items-center gap-1">
          <SimpleTooltip content="Выйти из урока" side="top">
            <button
              type="button"
              onClick={onLeave}
              className="flex size-11 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              aria-label="Выйти из урока"
            >
              <LogOut className="size-5" aria-hidden />
            </button>
          </SimpleTooltip>
          <span className="text-[11px] leading-none text-muted-foreground">Выйти</span>
        </div>
      </div>
    </TileMenuContext.Provider>,
    container,
  );
});

/**
 * Две постоянные плитки PiP (запрос 2026-10-13):
 *  - слева — тот, кто показывает экран (окно открывается только у него, это
 *    учитель или ученик с правом демонстрации);
 *  - справа — место говорящего: кто заговорил, тот встаёт сюда и остаётся,
 *    пока не заговорит кто-то другой. Тишина его не убирает — плитка не
 *    прыгает между словами. Пока никто не говорил — учитель (если экран
 *    показывает ученик), иначе первый вошедший.
 */
function PipTiles({ participants, selfId }: { participants: ParticipantSnapshot[]; selfId: string | undefined }) {
  const others = participants.filter((p) => p.userId !== selfId && p.connected);
  const speakingOther = useSpeakingParticipants().find((p) => p.identity !== selfId)?.identity;
  const [speakerId, setSpeakerId] = useState<string | null>(null);
  useEffect(() => {
    if (speakingOther) setSpeakerId(speakingOther);
  }, [speakingOther]);
  const self = participants.find((p) => p.userId === selfId);
  const speaker =
    others.find((p) => p.userId === speakerId) ??
    others.find((p) => p.kind === "staff" || p.cohost) ??
    [...others].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0];
  const tiles = [self, speaker].filter((p): p is ParticipantSnapshot => p !== undefined);
  return <RoomVideoGrid participants={tiles} selfId={selfId} ordered />;
}
