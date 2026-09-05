import { useState } from "react";
import { useLocalParticipant, useTracks } from "@livekit/components-react";
import { ScreenSharePresets, Track, VideoPreset } from "livekit-client";
import { MonitorUp, MonitorX } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

type ScreenShareContentType = "document" | "video";

/**
 * Э7.1, §5.2 ТЗ: «1080p@5fps для документов». `ScreenSharePresets`
 * (установленный `livekit-client@2.22.0`) не содержит готового пресета на
 * 5 fps (есть только `h1080fps15`/`h1080fps30`) — собственный `VideoPreset`
 * по тому же образцу. Битрейт 1 Мбит/с — ОЦЕНКА, не факт из ТЗ/LiveKit:
 * `h1080fps15` берёт 2.5 Мбит/с на 15 fps, при втрое меньшем fps (5)
 * пропорционально вышло бы ~0.83 Мбит/с, округлено чуть вверх ради чёткости
 * текста документа (низкий fps не должен экономить на резкости кадра).
 */
const DOCUMENT_SCREEN_SHARE_PRESET = new VideoPreset(1920, 1080, 1_000_000, 5, "medium");

/** §5.2 ТЗ: «720p@15fps для видео» — это готовый пресет LiveKit, ничего оценивать не пришлось. */
const CONTENT_PRESETS: Record<ScreenShareContentType, VideoPreset> = {
  document: DOCUMENT_SCREEN_SHARE_PRESET,
  video: ScreenSharePresets.h720fps15,
};

/**
 * Демонстрация экрана (Э7.1) — переключатель типа контента ДО старта:
 * «Документ» (1080p@5fps, `contentHint: "detail"` — приоритет чёткости
 * текста над плавностью) или «Видео» (720p@15fps, `contentHint: "motion"`).
 * Аудио вкладки НЕ запрашивается (`audio: false`) — стоп-лист Э7: «не
 * делать шаринг вкладки со звуком в MVP». `screenShareEncoding`, не
 * `videoEncoding` — прочитано в типах `TrackPublishDefaults`
 * (`options.d.ts`): `videoEncoding` — это параметры именно КАМЕРЫ,
 * демонстрация экрана кодируется отдельным полем.
 *
 * Право `canShareScreen` одно на учителя (по умолчанию,
 * `presence.ts#defaultPermissions`) и ученика по разрешению (Э7.4) — кнопка
 * одна и та же для обеих ролей, видимость решает вызывающая сторона
 * (`RoomPage.tsx`).
 *
 * Максимум 1 демонстрация одновременно и приоритет учителю (Э7.2) решает
 * СЕРВЕР по вебхуку `track_published` уже ПОСЛЕ публикации
 * (`rooms/service.ts#handleScreenShareStartedWebhook`) — раньше отменить
 * WebRTC-негоциацию с сервера нельзя, только погасить трек сразу после.
 * `disabled` здесь — не защита, а подсказка: не-учителю, пока кто-то уже
 * делится, кнопка недоступна, чтобы не заставлять его увидеть свою
 * демонстрацию и тут же потерять её. `priority` (учитель — эта проверка
 * его не касается, сервер и так пропустит его демонстрацию вперёд) решает
 * вызывающая сторона (`RoomPage.tsx`, знает `isTeacher`), как и
 * `maxResolution` у `SelfCameraButton`.
 */
export function SelfScreenShareButton({ priority = false }: { priority?: boolean }) {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const [contentType, setContentType] = useState<ScreenShareContentType>("document");
  const othersSharing = useTracks([Track.Source.ScreenShare], { onlySubscribed: false }).some(
    (t) => t.participant.identity !== localParticipant.identity,
  );
  const blocked = !isScreenShareEnabled && othersSharing && !priority;

  async function toggle() {
    if (isScreenShareEnabled) {
      await localParticipant.setScreenShareEnabled(false);
      return;
    }
    const preset = CONTENT_PRESETS[contentType];
    await localParticipant.setScreenShareEnabled(
      true,
      { audio: false, resolution: preset.resolution, contentHint: contentType === "document" ? "detail" : "motion" },
      { screenShareEncoding: preset.encoding },
    );
  }

  return (
    <div className="flex items-center gap-2">
      {!isScreenShareEnabled && (
        <Select
          value={contentType}
          onValueChange={(v) => setContentType(v as ScreenShareContentType)}
        >
          <SelectTrigger className="h-8 w-[190px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="document">Документ (1080p, 5 fps)</SelectItem>
            <SelectItem value="video">Видео (720p, 15 fps)</SelectItem>
          </SelectContent>
        </Select>
      )}
      <Button
        variant={isScreenShareEnabled ? "outline" : "secondary"}
        size="sm"
        onClick={toggle}
        disabled={blocked}
        title={blocked ? "Кто-то уже демонстрирует экран" : undefined}
      >
        {isScreenShareEnabled ? <MonitorX aria-hidden /> : <MonitorUp aria-hidden />}
        {isScreenShareEnabled ? "Остановить демонстрацию" : "Демонстрация экрана"}
      </Button>
    </div>
  );
}
