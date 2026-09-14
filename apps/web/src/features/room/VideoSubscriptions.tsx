import { useEffect } from "react";
import { useTracks } from "@livekit/components-react";
import { RemoteTrackPublication, Track } from "livekit-client";
import type { LessonMode, ParticipantSnapshot } from "@school/shared";

/**
 * Централизованное управление подпиской на аудио/видеотреки комнаты.
 * До Э6.2 `<LiveKitRoom>` полагался на автоподписку LiveKit (`autoSubscribe`,
 * включена по умолчанию в самом SDK), которая подписывает КАЖДОГО участника
 * на КАЖДЫЙ опубликованный трек. `autoSubscribe` выключен (`RoomPage.tsx`,
 * `connectOptions`), и этот компонент — единственное место, которое решает,
 * что подписывать.
 *
 * Раньше видимость камеры ученика зависела от режима урока/пина/того, кто
 * говорит (§5.2 ТЗ, экономия трафика при большом классе) — на практике это
 * читалось как баг: при переключении режима камера то появлялась, то
 * пропадала (решение пользователя, 2026-09-11: во всех режимах у всех
 * участников камера/микрофон/демонстрация подписаны всегда, без исключений
 * и лимитов — компромисс по трафику для теста не нужен).
 *
 * `useTracks(..., { onlySubscribed: false })` — намеренно `false` (дефолт
 * самого хука — `true`): нужно видеть ВСЕ опубликованные треки, включая ещё
 * не подписанные, иначе нечем было бы управлять. `publication instanceof
 * RemoteTrackPublication` отсеивает собственные публикации локального
 * участника — подписываться на свой же трек не нужно и нельзя
 * (`LocalTrackPublication.setSubscribed` не существует).
 */
export function VideoSubscriptionManager({
  participants,
  mode,
}: {
  participants: ParticipantSnapshot[];
  mode: LessonMode;
}) {
  const tracks = useTracks([Track.Source.Microphone, Track.Source.Camera, Track.Source.ScreenShare], {
    onlySubscribed: false,
  });

  useEffect(() => {
    for (const t of tracks) {
      const pub = t.publication;
      if (!(pub instanceof RemoteTrackPublication)) continue;
      if (!pub.isSubscribed) pub.setSubscribed(true);
    }
    // participants/mode больше не влияют на выбор — эффект перезапускается
    // при их смене только чтобы подхватить треки новых участников/пере-
    // публикаций, реальный список берётся из `tracks`.
  }, [tracks, participants, mode]);

  return null;
}
