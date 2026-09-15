import { useEffect, useState } from "react";
import {
  Camera,
  Disc,
  Film,
  Gauge,
  LinkIcon,
  Mic,
  MonitorUp,
  PictureInPicture2,
  Waves,
} from "lucide-react";
import type {
  Framerate,
  MediaQualityPreset,
  SchoolSettings,
  UpdateSchoolSettingsRequest,
} from "@school/shared";

import { useAsync } from "@/shared/hooks/use-async";
import { ApiError } from "@/shared/api-client";
import { Card } from "@/shared/ui/card";
import { ErrorState } from "@/shared/ui/error-state";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";
import { toast } from "@/shared/ui/sonner";
import { getSchoolSettings, updateSchoolSettings } from "./settings-api.js";

/**
 * Пользовательский запрос (2026-09-14, §10.10 ТЗ): страница администратора
 * «Параметры» — feature-флаги школы + мягкие дефолты качества медиа,
 * включая явный битрейт (запрос «более гибкие настройки ... выставить
 * битрейт») для камеры, демонстрации и записи урока.
 * Переключатели/селекты применяются сразу по изменению; битрейт (текстовое
 * поле) — по потере фокуса/Enter, чтобы не слать PATCH на каждую цифру.
 */

const MEDIA_QUALITY_OPTIONS: Array<{ value: MediaQualityPreset; label: string }> = [
  { value: "360p", label: "360p" },
  { value: "480p", label: "480p" },
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
];

const FPS_OPTIONS: Array<{ value: Framerate; label: string }> = [
  { value: 15, label: "15 кадр/с" },
  { value: 24, label: "24 кадр/с" },
  { value: 30, label: "30 кадр/с" },
];

const BITRATE_MIN = 100;
const BITRATE_MAX = 8000;

function Row({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h2 className="ds-label mb-1">{title}</h2>
      <div className="divide-y divide-border">{children}</div>
    </Card>
  );
}

/** Числовое поле битрейта (Кбит/с) — коммитит по blur/Enter, не по каждому нажатию клавиши. */
function BitrateInput({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled?: boolean;
  onCommit: (kbps: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);

  function commit() {
    const n = Math.round(Number(local));
    if (Number.isFinite(n) && n >= BITRATE_MIN && n <= BITRATE_MAX) {
      if (n !== value) onCommit(n);
      else setLocal(String(value));
    } else {
      toast.error(`Битрейт — число от ${BITRATE_MIN} до ${BITRATE_MAX} Кбит/с`);
      setLocal(String(value));
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        inputMode="numeric"
        min={BITRATE_MIN}
        max={BITRATE_MAX}
        step={50}
        className="w-24 text-right"
        value={local}
        disabled={disabled}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <span className="text-sm text-muted-foreground">Кбит/с</span>
    </div>
  );
}

export function SettingsPage() {
  const { data, error, loading, reload, setData } = useAsync(() => getSchoolSettings(), []);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function patch(key: string, value: UpdateSchoolSettingsRequest) {
    if (!data) return;
    const prev = data;
    setData({ ...data, ...value });
    setSavingKey(key);
    try {
      const next = await updateSchoolSettings(value);
      setData(next);
    } catch (e) {
      setData(prev);
      toast.error(e instanceof ApiError ? e.message : "Не удалось сохранить параметр");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Параметры" subtitle="Функции школы и качество медиа по умолчанию" />

      {loading ? (
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : error || !data ? (
        <ErrorState description={error ?? undefined} onRetry={reload} />
      ) : (
        <div className="flex flex-col gap-5">
          <Section title="Функции">
            <Row
              icon={LinkIcon}
              title="Гостевой доступ по ссылке"
              description="Ученик может войти в урок без аккаунта по прямой ссылке (/j/...)"
            >
              <Switch
                checked={data.guestAccessEnabled}
                disabled={savingKey === "guestAccessEnabled"}
                onCheckedChange={(v) => void patch("guestAccessEnabled", { guestAccessEnabled: v })}
              />
            </Row>
            <Row icon={Disc} title="Запись урока" description="Учитель/админ может начать запись урока">
              <Switch
                checked={data.recordingEnabled}
                disabled={savingKey === "recordingEnabled"}
                onCheckedChange={(v) => void patch("recordingEnabled", { recordingEnabled: v })}
              />
            </Row>
            <Row
              icon={MonitorUp}
              title="Демонстрация экрана"
              description="Кнопка демонстрации экрана доступна на уроке"
            >
              <Switch
                checked={data.screenShareEnabled}
                disabled={savingKey === "screenShareEnabled"}
                onCheckedChange={(v) => void patch("screenShareEnabled", { screenShareEnabled: v })}
              />
            </Row>
            <Row
              icon={PictureInPicture2}
              title="Картинка в картинке"
              description="Авто-PiP и кнопка «картинка в картинке» во время демонстрации"
            >
              <Switch
                checked={data.pipEnabled}
                disabled={savingKey === "pipEnabled"}
                onCheckedChange={(v) => void patch("pipEnabled", { pipEnabled: v })}
              />
            </Row>
          </Section>

          <Section title="Качество камеры и звука">
            <p className="pb-3 text-xs text-muted-foreground">
              Мягкие дефолты — подставляются при публикации, участник может выбрать своё устройство.
            </p>
            <Row icon={Camera} title="Разрешение камеры" description="Дефолт для видео учителя на уроке">
              <Select
                value={data.cameraResolution}
                disabled={savingKey === "cameraResolution"}
                onValueChange={(v) =>
                  void patch("cameraResolution", { cameraResolution: v as MediaQualityPreset })
                }
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEDIA_QUALITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row icon={Film} title="Частота кадров камеры" description="Кадров в секунду для видео учителя">
              <Select
                value={String(data.cameraFps)}
                disabled={savingKey === "cameraFps"}
                onValueChange={(v) => void patch("cameraFps", { cameraFps: Number(v) as Framerate })}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FPS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row icon={Gauge} title="Битрейт камеры" description="Сколько данных в секунду уходит на видео учителя">
              <BitrateInput
                value={data.cameraBitrateKbps}
                disabled={savingKey === "cameraBitrateKbps"}
                onCommit={(kbps) => void patch("cameraBitrateKbps", { cameraBitrateKbps: kbps })}
              />
            </Row>
            <Row icon={Mic} title="Высокое качество звука" description="Стерео-захват микрофона вместо моно">
              <Switch
                checked={data.micHighQuality}
                disabled={savingKey === "micHighQuality"}
                onCheckedChange={(v) => void patch("micHighQuality", { micHighQuality: v })}
              />
            </Row>
            <Row
              icon={Waves}
              title="Шумоподавление микрофона"
              description="Убирает фоновый шум на стороне участника (браузер), не нагружает сервер"
            >
              <Switch
                checked={data.noiseSuppressionEnabled}
                disabled={savingKey === "noiseSuppressionEnabled"}
                onCheckedChange={(v) =>
                  void patch("noiseSuppressionEnabled", { noiseSuppressionEnabled: v })
                }
              />
            </Row>
          </Section>

          <Section title="Качество демонстрации экрана">
            <Row
              icon={MonitorUp}
              title="Разрешение демонстрации"
              description="Дефолт для показа экрана/документа на уроке"
            >
              <Select
                value={data.screenShareResolution}
                disabled={savingKey === "screenShareResolution"}
                onValueChange={(v) =>
                  void patch("screenShareResolution", { screenShareResolution: v as MediaQualityPreset })
                }
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEDIA_QUALITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row
              icon={Film}
              title="Частота кадров демонстрации"
              description="Ниже — резче текст документа, выше — плавнее видео/анимация"
            >
              <Select
                value={String(data.screenShareFps)}
                disabled={savingKey === "screenShareFps"}
                onValueChange={(v) =>
                  void patch("screenShareFps", { screenShareFps: Number(v) as Framerate })
                }
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FPS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row icon={Gauge} title="Битрейт демонстрации" description="Сколько данных в секунду уходит на показ экрана">
              <BitrateInput
                value={data.screenShareBitrateKbps}
                disabled={savingKey === "screenShareBitrateKbps"}
                onCommit={(kbps) => void patch("screenShareBitrateKbps", { screenShareBitrateKbps: kbps })}
              />
            </Row>
          </Section>

          <Section title="Запись урока">
            <p className="pb-3 text-xs text-muted-foreground">
              Разрешение/fps/битрейт видеозаписи урока (LiveKit Egress) — выше значения нагружают CPU записи
              сильнее и дают больший файл.
            </p>
            <Row icon={Camera} title="Разрешение записи" description="Разрешение видеофайла урока">
              <Select
                value={data.recordingResolution}
                disabled={savingKey === "recordingResolution"}
                onValueChange={(v) =>
                  void patch("recordingResolution", { recordingResolution: v as MediaQualityPreset })
                }
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEDIA_QUALITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row icon={Film} title="Частота кадров записи" description="Кадров в секунду в видеофайле урока">
              <Select
                value={String(data.recordingFps)}
                disabled={savingKey === "recordingFps"}
                onValueChange={(v) => void patch("recordingFps", { recordingFps: Number(v) as Framerate })}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FPS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row icon={Gauge} title="Битрейт записи" description="Сколько данных в секунду уходит на видеофайл урока">
              <BitrateInput
                value={data.recordingBitrateKbps}
                disabled={savingKey === "recordingBitrateKbps"}
                onCommit={(kbps) => void patch("recordingBitrateKbps", { recordingBitrateKbps: kbps })}
              />
            </Row>
          </Section>
        </div>
      )}
    </div>
  );
}
