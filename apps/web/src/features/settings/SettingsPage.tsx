import { useState } from "react";
import {
  Camera,
  Disc,
  Film,
  LinkIcon,
  Mic,
  MonitorUp,
  PictureInPicture2,
  Settings as SettingsIcon,
} from "lucide-react";
import type {
  Framerate,
  MediaQualityPreset,
  RecordingQualityPreset,
  SchoolSettings,
  UpdateSchoolSettingsRequest,
} from "@school/shared";

import { useAsync } from "@/shared/hooks/use-async";
import { ApiError } from "@/shared/api-client";
import { Card } from "@/shared/ui/card";
import { ErrorState } from "@/shared/ui/error-state";
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
 * «Параметры» — feature-флаги школы + мягкие дефолты качества медиа.
 * Применяется сразу по изменению (без отдельной кнопки «Сохранить») —
 * тот же паттерн, что переключатели в других местах приложения.
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

const RECORDING_QUALITY_OPTIONS: Array<{ value: RecordingQualityPreset; label: string; hint: string }> = [
  { value: "720p30", label: "720p, 30 кадр/с", hint: "~1.5 Мбит/с — дефолт, меньше места на диске" },
  { value: "1080p30", label: "1080p, 30 кадр/с", hint: "выше нагрузка на CPU записи и больше файлы" },
];

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
            <Row icon={Mic} title="Высокое качество звука" description="Стерео-захват микрофона вместо моно">
              <Switch
                checked={data.micHighQuality}
                disabled={savingKey === "micHighQuality"}
                onCheckedChange={(v) => void patch("micHighQuality", { micHighQuality: v })}
              />
            </Row>
          </Section>

          <Section title="Запись урока">
            <Row
              icon={SettingsIcon}
              title="Качество записи"
              description="Пресет для видеозаписи урока (LiveKit Egress)"
            >
              <Select
                value={data.recordingQuality}
                disabled={savingKey === "recordingQuality"}
                onValueChange={(v) =>
                  void patch("recordingQuality", { recordingQuality: v as RecordingQualityPreset })
                }
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECORDING_QUALITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <p className="pt-3 text-xs text-muted-foreground">
              {RECORDING_QUALITY_OPTIONS.find((o) => o.value === data.recordingQuality)?.hint}
            </p>
          </Section>
        </div>
      )}
    </div>
  );
}
