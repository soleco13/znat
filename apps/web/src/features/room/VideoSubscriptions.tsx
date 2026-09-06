import { useEffect } from "react";
import { useSpeakingParticipants, useTracks } from "@livekit/components-react";
import { RemoteTrackPublication, Track } from "livekit-client";
import type { LessonMode, ParticipantSnapshot } from "@school/shared";

/** Э6.2, §5.2 ТЗ: не более 9 одновременно видимых видео учеников (лимит применяется только в режиме "discussion", см. computeVisibleStudentIds). */
export const MAX_VISIBLE_STUDENT_VIDEOS = 9;

/** Э12.4: LiveKit-атрибут участника теперь `kind` (`staff | guest`), а не роль. */
function isStaffAttr(kind: string | undefined): boolean {
  return kind === "staff";
}

/**
 * Выбор видимого набора учеников по режиму урока (Э6.4, §5.3 ТЗ) —
 * вынесено отдельной функцией от `VideoSubscriptionManager`, чтобы менять
 * ТОЛЬКО выбор при следующей задаче на эту тему, не механизм подписки:
 * - `lecture` (дефолт, §5.2 ТЗ — экономит 3–4× трафика) — видео учеников не
 *   подписывается ВООБЩЕ, пустой набор;
 * - `assignment` — «видео полностью выключено» (медиапрофиль из таблицы
 *   §5.3 ТЗ), тоже пустой набор для учеников (камера учителя гасится
 *   отдельно, см. `VideoSubscriptionManager`, это не про учеников);
 * - `spotlight` («Опрос/у доски») — «1 ученик крупно» — ровно один,
 *   закреплённый учителем (`pinned`); активный говорящий здесь
 *   сознательно НЕ подставляется вместо пина — режим про то, что учитель
 *   явно выбрал, кто у доски, а не про то, кто громче всех;
 * - `discussion` — закреплённые ∪ говорящие (Э6.3), до `MAX_VISIBLE_STUDENT_VIDEOS`,
 *   закреплённые в приоритете при превышении лимита.
 */
function computeVisibleStudentIds(
  mode: LessonMode,
  pinnedIds: Set<string>,
  speakingIds: Set<string>,
  publishingStudentIds: Set<string>,
): Set<string> {
  if (mode === "lecture" || mode === "assignment") return new Set();

  if (mode === "spotlight") {
    const pinned = [...pinnedIds].filter((id) => publishingStudentIds.has(id)).sort();
    return new Set(pinned.slice(0, 1));
  }

  const priority = [
    ...[...pinnedIds].filter((id) => publishingStudentIds.has(id)).sort(),
    ...[...speakingIds].filter((id) => publishingStudentIds.has(id) && !pinnedIds.has(id)).sort(),
  ];
  return new Set(priority.slice(0, MAX_VISIBLE_STUDENT_VIDEOS));
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
 * - микрофон — подписывается всегда, для любого участника, независимо от
 *   режима урока (лимит §5.2 — не на подписку, а на ОДНОВРЕМЕННО ВКЛЮЧЁННЫЕ
 *   микрофоны учеников, уже есть на уровне права `canSpeak`); §5.3 ТЗ
 *   называет медиапрофиль `assignment` «только аудио учителя», но это про
 *   то, что обычно слышно, а не про запрет подписки на чужой микрофон —
 *   право `canSpeak` и так решает, кто вообще может говорить;
 * - камера учителя/админа — подписывается всегда, КРОМЕ режима `assignment`
 *   (§5.3 ТЗ: «видео полностью выключено» — единственный режим, где гасится
 *   даже учитель, не только сетка учеников);
 * - камера ученика — подписывается по набору из `computeVisibleStudentIds`
 *   (Э6.4 меняет только выбор набора по режиму, см. её docstring);
 * - демонстрация экрана (Э7.1) — подписывается ВСЕГДА, независимо от роли
 *   и режима: максимум 1 одновременно на всю комнату (Э7.2, сервер сам это
 *   гарантирует), лишней нагрузки в духе «сетки из 9» тут в принципе не
 *   может возникнуть, гейтить нечего.
 *
 * `useTracks(..., { onlySubscribed: false })` — намеренно `false` (дефолт
 * самого хука — `true`, прочитано в установленном `@livekit/components-react`):
 * нужно видеть ВСЕ опубликованные треки, включая ещё не подписанные, иначе
 * нечем было бы управлять. `publication instanceof RemoteTrackPublication`
 * отсеивает собственные публикации локального участника — подписываться на
 * свой же трек не нужно и нельзя (`LocalTrackPublication.setSubscribed` не
 * существует).
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
  const speakingParticipants = useSpeakingParticipants();

  useEffect(() => {
    const pinnedIds = new Set(participants.filter((p) => p.pinned).map((p) => p.userId));
    const speakingIds = new Set(
      speakingParticipants.filter((p) => !isStaffAttr(p.attributes.kind)).map((p) => p.identity),
    );
    const publishingStudentIds = new Set(
      tracks
        .filter((t) => t.source === Track.Source.Camera && !isStaffAttr(t.participant.attributes.kind))
        .map((t) => t.participant.identity),
    );
    const visibleStudentIds = computeVisibleStudentIds(mode, pinnedIds, speakingIds, publishingStudentIds);
    const teacherVisible = mode !== "assignment";

    for (const t of tracks) {
      const pub = t.publication;
      if (!(pub instanceof RemoteTrackPublication)) continue;

      const shouldSubscribe =
        t.source === Track.Source.Microphone ||
        t.source === Track.Source.ScreenShare ||
        (isStaffAttr(t.participant.attributes.kind) && teacherVisible) ||
        visibleStudentIds.has(t.participant.identity);

      if (pub.isSubscribed !== shouldSubscribe) pub.setSubscribed(shouldSubscribe);
    }
  }, [tracks, speakingParticipants, participants, mode]);

  return null;
}
