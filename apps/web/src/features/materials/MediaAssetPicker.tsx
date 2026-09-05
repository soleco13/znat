import { useEffect, useState, type ChangeEvent } from "react";
import { Upload } from "lucide-react";
import type { MediaAsset, MediaAssetKind } from "@school/shared";

import { cn } from "@/lib/utils";
import { Button } from "@/shared/ui/button";
import { listMediaAssets, uploadMediaAsset } from "./materials-api.js";

/**
 * Медиатека — пикер файла для `image`/`audio` блоков (Э9.7). Выбор из уже
 * загруженного (список общий на школу) или загрузка нового. Список грузится
 * один раз при монтировании.
 */
export function MediaAssetPicker({
  kind,
  assetId,
  onChange,
}: {
  kind: MediaAssetKind;
  assetId: string;
  onChange: (assetId: string) => void;
}) {
  const [items, setItems] = useState<MediaAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listMediaAssets(kind)
      .then((res) => !cancelled && setItems(res.items))
      .catch(() => !cancelled && setError("Не удалось загрузить медиатеку"));
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const selected = items?.find((i) => i.id === assetId) ?? null;

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const asset = await uploadMediaAsset(file);
      setItems((prev) => [asset, ...(prev ?? [])]);
      onChange(asset.id);
      setBrowsing(false);
    } catch {
      setError(
        "Не удалось загрузить файл (PNG/JPEG/WebP для картинок, MP3/WAV/OGG/M4A/WebM для аудио)",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {selected ? (
        <AssetPreview asset={selected} />
      ) : assetId ? (
        <p className="text-[11px] font-medium text-warning">
          Файл не найден в медиатеке (id: {assetId})
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">Файл не выбран</p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setBrowsing((b) => !b)}>
          {browsing ? "Скрыть медиатеку" : "Выбрать из медиатеки"}
        </Button>
        <Button asChild variant="outline" size="sm" className="cursor-pointer">
          <label>
            <Upload aria-hidden />
            {uploading ? "Загрузка…" : "Загрузить новый"}
            <input
              type="file"
              accept={
                kind === "image"
                  ? "image/png,image/jpeg,image/webp"
                  : "audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm"
              }
              onChange={handleUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
        </Button>
      </div>
      {error && <p className="text-[11px] font-medium text-destructive">{error}</p>}
      {browsing && (
        <div className="max-h-56 overflow-y-auto rounded-md border border-border p-2">
          {items === null && <p className="text-xs text-muted-foreground">Загрузка…</p>}
          {items?.length === 0 && (
            <p className="text-xs text-muted-foreground">В медиатеке пока пусто</p>
          )}
          <ul className={kind === "image" ? "grid grid-cols-4 gap-2" : "flex flex-col gap-1.5"}>
            {items?.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(item.id);
                    setBrowsing(false);
                  }}
                  className={cn(
                    "w-full rounded-md border p-1 text-left transition-colors",
                    item.id === assetId
                      ? "border-primary bg-accent"
                      : "border-border hover:bg-secondary",
                  )}
                >
                  {kind === "image" ? (
                    <img
                      src={item.url}
                      alt={item.originalName}
                      className="h-16 w-full rounded object-cover"
                    />
                  ) : (
                    <span className="block truncate text-xs" title={item.originalName}>
                      {item.originalName}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AssetPreview({ asset }: { asset: MediaAsset }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border p-2">
      {asset.kind === "image" ? (
        <img
          src={asset.url}
          alt={asset.originalName}
          className="size-12 rounded object-cover"
        />
      ) : (
        <audio src={asset.url} controls className="h-8 flex-1" />
      )}
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {asset.originalName}
      </span>
    </div>
  );
}
