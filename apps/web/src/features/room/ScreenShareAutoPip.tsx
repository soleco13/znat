import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocalParticipant } from "@livekit/components-react";
import { MonitorX } from "lucide-react";
import type { ParticipantSnapshot } from "@school/shared";

import { RoomControlButton } from "./RoomControlButton.js";
import { RoomVideoGrid } from "./RoomVideoGrid.js";
import { SelfMicButton } from "./MicControls.js";

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
 * `createPortal` рендерится наш собственный `RoomVideoGrid` (та же
 * адаптивная сетка, что и на обычном стейдже) + `SelfMicButton` и кнопка
 * «Остановить демонстрацию» — оба уже из дизайн-системы проекта, никакой
 * отдельной вёрстки под PiP не пишем.
 *
 * НЕТ отдельной кнопки в интерфейсе — включается/выключается только вместе
 * с демонстрацией экрана (запрос пользователя). `open()` дёргает
 * `SelfScreenShareButton` из СВОЕГО клик-хендлера сразу после старта
 * демонстрации: `documentPictureInPicture.requestWindow()`, как и
 * `requestPictureInPicture()`, требует свежий user activation — из
 * отдельного эффекта браузер мог бы отказать.
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

export interface ScreenShareAutoPipHandle {
  open: () => Promise<void>;
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
  { participants: ParticipantSnapshot[]; selfId: string | undefined }
>(function ScreenShareAutoPip({ participants, selfId }, ref) {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const pipWindowRef = useRef<Window | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  async function open() {
    if (pipWindowRef.current || !window.documentPictureInPicture) return;
    let pipWindow: Window;
    try {
      pipWindow = await window.documentPictureInPicture.requestWindow({ width: 300, height: 220 });
    } catch {
      // Нет свежего user activation или браузер не поддерживает — тихо
      // пропускаем, демонстрация экрана от этого не зависит (§1.2 ТЗ).
      return;
    }
    copyStylesInto(pipWindow.document);
    pipWindow.document.body.className = "bg-background";
    const root = pipWindow.document.createElement("div");
    root.className = "flex h-full min-h-0 flex-col gap-2 p-2";
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

  useImperativeHandle(ref, () => ({ open }));

  // Закрытие — в любую сторону (наша кнопка «Стоп», браузерная панель
  // «Остановить демонстрацию», обрыв трека): не требует user activation,
  // можно реагировать эффектом.
  useEffect(() => {
    if (!isScreenShareEnabled) pipWindowRef.current?.close();
  }, [isScreenShareEnabled]);

  if (!container) return null;

  const others = participants.filter((p) => p.userId !== selfId);

  return createPortal(
    <>
      <div className="min-h-0 flex-1">
        <RoomVideoGrid participants={others} selfId={selfId} />
      </div>
      <div className="flex shrink-0 items-center justify-center gap-2">
        <SelfMicButton />
        <RoomControlButton
          tone="action"
          active={false}
          activeIcon={MonitorX}
          inactiveIcon={MonitorX}
          activeLabel="Остановить демонстрацию"
          inactiveLabel="Остановить демонстрацию"
          onToggle={() => void localParticipant.setScreenShareEnabled(false)}
          caption="Стоп"
        />
      </div>
    </>,
    container,
  );
});
