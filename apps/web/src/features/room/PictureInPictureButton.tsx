import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useSpeakingParticipants, useTracks, VideoTrack } from "@livekit/components-react";
import { Track } from "livekit-client";
import { PictureInPicture2 } from "lucide-react";
import type { ParticipantSnapshot } from "@school/shared";

import { RoomControlButton } from "./RoomControlButton.js";

/**
 * «Картинка в картинке» — как в Толке: отдельная кнопка (проверено вживую,
 * shkola10.ktalk.ru → значок раскладки → «Картинка в картинке»), а не
 * скрытая логика без интерфейса. Плюс — авто-запуск на время демонстрации
 * экрана (запрос пользователя): пока делишься экраном, своё окно урока
 * обычно позади демонстрируемого приложения, PiP держит собеседника на
 * виду без лишнего клика. `requestPip` дёргает именно `ScreenShareControls`
 * через `ref` — единый источник (видео/цель/состояние) на оба пути
 * включения, а не два независимых.
 *
 * Кого показывать: закреплённый участник (Э6.3 — штатный способ учителя
 * выделить ученика), иначе говорящий, иначе первый по тому же порядку,
 * что плитки в `RoomVideoGrid` (сначала персонал, потом по времени
 * входа). Только с включённой камерой и не сам пользователь — смотреть
 * своё же видео в PiP смысла нет.
 */
function pickPipTarget<T>(
  participants: ParticipantSnapshot[],
  selfId: string | undefined,
  cameraTrackByIdentity: Map<string, T>,
  speakingIds: Set<string>,
): T | null {
  const candidates = participants.filter(
    (p) => p.connected && p.userId !== selfId && cameraTrackByIdentity.has(p.userId),
  );
  if (candidates.length === 0) return null;
  const pinned = candidates.find((p) => p.pinned);
  if (pinned) return cameraTrackByIdentity.get(pinned.userId)!;
  const speaking = candidates.find((p) => speakingIds.has(p.userId));
  if (speaking) return cameraTrackByIdentity.get(speaking.userId)!;
  const sorted = [...candidates].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "staff" ? -1 : 1;
    return a.joinedAt.localeCompare(b.joinedAt);
  });
  return cameraTrackByIdentity.get(sorted[0]!.userId)!;
}

/** Императивный хендл — `SelfScreenShareButton` дёргает `requestPip()`
 *  из СВОЕГО клик-хендлера (см. докстринг выше и в `ScreenShareControls`). */
export interface PictureInPictureHandle {
  requestPip: () => Promise<void>;
}

export const PictureInPictureButton = forwardRef<
  PictureInPictureHandle,
  { participants: ParticipantSnapshot[]; selfId: string | undefined }
>(function PictureInPictureButton({ participants, selfId }, ref) {
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const cameraTrackByIdentity = new Map(cameraTracks.map((t) => [t.participant.identity, t]));
  const speakingIds = new Set(useSpeakingParticipants().map((p) => p.identity));
  const pipTarget = useMemo(
    () => pickPipTarget(participants, selfId, cameraTrackByIdentity, speakingIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [participants, selfId, cameraTracks, speakingIds],
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);

  // Синхронизируем кнопку и с закрытием PiP не через нашу кнопку (крестик
  // на самом плавающем окне, Esc, смена вкладки) — событие даёт браузер.
  // Зависимость — именно наличие цели: скрытое `<video>` монтируется/
  // размонтируется вместе с ним (условный рендер ниже), а не при смене
  // пропа `trackRef` на уже смонтированном элементе.
  const hasTarget = pipTarget !== null;
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onEnter = () => setActive(true);
    const onLeave = () => setActive(false);
    el.addEventListener("enterpictureinpicture", onEnter);
    el.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      el.removeEventListener("enterpictureinpicture", onEnter);
      el.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [hasTarget]);

  // Только «войти» — используется и кнопкой (когда не активно), и
  // `SelfScreenShareButton` при старте демонстрации. Там, в отличие от
  // прямого клика по этой кнопке, свежего user activation может уже не
  // быть (см. докстрин в ScreenShareControls) — тогда браузер тихо
  // откажет, `.catch` гасит исключение, демонстрация не должна страдать.
  async function requestPip() {
    if (document.pictureInPictureElement || !videoRef.current) return;
    await videoRef.current.requestPictureInPicture().catch(() => undefined);
  }
  useImperativeHandle(ref, () => ({ requestPip }));

  // SPA без SSR (Vite) — `document` всегда есть; браузер без поддержки
  // PiP (или запрещённой политикой) просто не получает эту кнопку.
  if (!document.pictureInPictureEnabled) return null;

  async function toggle() {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => undefined);
      return;
    }
    // Прямой клик — свежий user activation есть всегда.
    await requestPip();
  }

  return (
    <>
      {pipTarget ? (
        <VideoTrack
          ref={videoRef}
          trackRef={pipTarget}
          muted
          autoPlay
          playsInline
          className="pointer-events-none fixed bottom-0 right-0 -z-50 size-px opacity-0"
        />
      ) : null}
      <RoomControlButton
        tone="action"
        active={active}
        activeIcon={PictureInPicture2}
        inactiveIcon={PictureInPicture2}
        activeLabel="Свернуть картинку в картинке"
        inactiveLabel="Картинка в картинке"
        onToggle={toggle}
        disabled={!pipTarget}
        title={!pipTarget ? "Никто из участников не включил камеру" : undefined}
        caption="PiP"
      />
    </>
  );
});
