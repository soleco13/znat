import { useEffect } from "react";
import { useSpeakingParticipants, useTracks } from "@livekit/components-react";
import { RemoteTrackPublication, Track } from "livekit-client";
import type { ParticipantSnapshot } from "@school/shared";

/** Э6.2, §5.2 ТЗ: не более 9 одновременно видимых видео учеников. */
export const MAX_VISIBLE_STUDENT_VIDEOS = 9;

function isTeacherRole(role: string | undefined): boolean {
  return role === "teacher" || role === "admin";
}

/**
 * Централизованное управление подпиской на аудио/видеотреки комнаты (Э6.2,
 * §5.2 ТЗ: «подписка на видео только для видимых»). До Э6.2 `<LiveKitRoom>`
 * полагался на автоподписку LiveKit (`autoSubscribe`, включена по умолчанию
 * в самом SDK — прочитано в установленном `livekit-client@2.22.0`), которая
 * подписывает КАЖДОГО участника на КАЖДЫЙ опубликованный трек в комнате;
 * при 30 учениках с камерой это ровно арифметика §5.1 ТЗ (полная сетка —
 * сотни видеопотоков на один урок). `autoSubscribe` теперь выключен
 * (`RoomPage.tsx`, `connectOptions`), и этот компонент — единственное
 * место, которое решает, что подписывать:
 * - микрофон — подписывается всегда, для любого участника. Лимит §5.2 —
 *   не на подписку, а на ОДНОВРЕМЕННО ВКЛЮЧЁННЫЕ микрофоны учеников (уже
 *   есть на уровне права `canSpeak`, см. `rooms/service.ts`), аудиотрафик
 *   на подписчика не растёт с числом участников так резко, как видео;
 * - камера учителя/админа — подписывается всегда: это отдельная плитка
 *   (`TeacherVideoTile`), не «ученик в сетке», в лимит на 9 не входит;
 * - камера ученика — подписывается, только если участник входит в текущий
 *   видимый набор (максимум `MAX_VISIBLE_STUDENT_VIDEOS`).
 *
 * **Выбор видимого набора (Э6.3, §5.2 ТЗ)**: закреплённые учителем
 * (`participants[].pinned`, право учителя — `rooms/service.ts#setPinned`)
 * + активные говорящие (`useSpeakingParticipants`, решение и сглаживание
 * «говорит/не говорит» целиком на стороне LiveKit — `Participant.isSpeaking`
 * не пересчитывается здесь заново). Если оба набора вместе не влезают в
 * лимit, закреплённые в приоритете (учитель явно решил их видеть). Если
 * никто не закреплён и не говорит — сетка видео пуста, все ученики видны
 * как аватары; ТЗ определяет видимый набор именно как «говорящие +
 * закреплённые», а не «до 9 первых попавшихся», поэтому пустая сетка при
 * полной тишине — ожидаемое поведение, не бага Э6.2.
 *
 * `useTracks(..., { onlySubscribed: false })` — намеренно `false` (дефолт
 * самого хука — `true`, прочитано в установленном `@livekit/components-react`):
 * нужно видеть ВСЕ опубликованные треки, включая ещё не подписанные, иначе
 * нечем было бы управлять. `publication instanceof RemoteTrackPublication`
 * отсеивает собственные публикации локального участника — подписываться на
 * свой же трек не нужно и нельзя (`LocalTrackPublication.setSubscribed` не
 * существует).
 */
export function VideoSubscriptionManager({ participants }: { participants: ParticipantSnapshot[] }) {
  const tracks = useTracks([Track.Source.Microphone, Track.Source.Camera], { onlySubscribed: false });
  const speakingParticipants = useSpeakingParticipants();

  useEffect(() => {
    const pinnedIds = new Set(participants.filter((p) => p.pinned).map((p) => p.userId));
    const speakingIds = new Set(
      speakingParticipants.filter((p) => !isTeacherRole(p.attributes.role)).map((p) => p.identity),
    );
    const publishingStudentIds = new Set(
      tracks
        .filter((t) => t.source === Track.Source.Camera && !isTeacherRole(t.participant.attributes.role))
        .map((t) => t.participant.identity),
    );

    const priority = [
      ...[...pinnedIds].filter((id) => publishingStudentIds.has(id)).sort(),
      ...[...speakingIds].filter((id) => publishingStudentIds.has(id) && !pinnedIds.has(id)).sort(),
    ];
    const visibleStudentIds = new Set(priority.slice(0, MAX_VISIBLE_STUDENT_VIDEOS));

    for (const t of tracks) {
      const pub = t.publication;
      if (!(pub instanceof RemoteTrackPublication)) continue;

      const shouldSubscribe =
        t.source === Track.Source.Microphone ||
        isTeacherRole(t.participant.attributes.role) ||
        visibleStudentIds.has(t.participant.identity);

      if (pub.isSubscribed !== shouldSubscribe) pub.setSubscribed(shouldSubscribe);
    }
  }, [tracks, speakingParticipants, participants]);

  return null;
}
