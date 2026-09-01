import { useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { ScreenSharePresets, VideoPreset } from "livekit-client";

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
 */
export function SelfScreenShareButton() {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const [contentType, setContentType] = useState<ScreenShareContentType>("document");

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
        <select
          value={contentType}
          onChange={(e) => setContentType(e.target.value as ScreenShareContentType)}
          className="rounded border px-1 py-0.5 text-xs"
        >
          <option value="document">Документ (1080p, 5 fps)</option>
          <option value="video">Видео (720p, 15 fps)</option>
        </select>
      )}
      <button
        onClick={toggle}
        className={`rounded border px-3 py-1 text-sm ${isScreenShareEnabled ? "border-red-300 text-red-700" : ""}`}
      >
        {isScreenShareEnabled ? "Остановить демонстрацию" : "Демонстрация экрана"}
      </button>
    </div>
  );
}
