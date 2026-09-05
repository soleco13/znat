import { useEffect, useState, type ChangeEvent } from "react";
import type { MediaAsset, MediaAssetKind } from "@school/shared";
import { listMediaAssets, uploadMediaAsset } from "./materials-api.js";

/**
 * Медиатека — пикер файла для `image`/`audio` блоков (Э9.7, §7.2 ТЗ:
 * «загруженные картинки/аудио, с переиспользованием между материалами»).
 * Заменяет собой `TextField` «id файла в медиатеке» (Э9.2/9.3): раньше
 * методист вписывал `assetId` руками (взять его было неоткуда, кроме БД
 * напрямую), теперь — либо выбирает уже загруженный кем-то файл (список
 * общий на школу, не только свои загрузки — смысл в переиспользовании
 * МЕЖДУ авторами), либо грузит новый.
 *
 * Список загружается ОДИН раз при монтировании (не при каждом открытии
 * панели «Выбрать из медиатеки») — тот же файл, скорее всего, понадобится
 * ещё не раз в рамках одной сессии редактирования, а сама медиатека школы
 * не настолько велика, чтобы это было проблемой (типичный объём — Chrome
 * DevTools MCP сможет подтвердить/опровергнуть на живой сессии, задел).
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
    e.target.value = ""; // разрешить выбрать тот же файл повторно
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const asset = await uploadMediaAsset(file);
      setItems((prev) => [asset, ...(prev ?? [])]);
      onChange(asset.id);
      setBrowsing(false);
    } catch {
      setError("Не удалось загрузить файл (поддерживаются PNG/JPEG/WebP для картинок, MP3/WAV/OGG/M4A/WebM для аудио)");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {selected ? (
        <AssetPreview asset={selected} />
      ) : assetId ? (
        <p className="text-[11px] text-amber-600">Файл не найден в медиатеке (id: {assetId})</p>
      ) : (
        <p className="text-[11px] text-slate-400">Файл не выбран</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setBrowsing((b) => !b)}
          className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
        >
          {browsing ? "Скрыть медиатеку" : "Выбрать из медиатеки"}
        </button>
        <label className="cursor-pointer rounded border px-2 py-1 text-xs hover:bg-slate-50">
          {uploading ? "Загрузка…" : "Загрузить новый"}
          <input
            type="file"
            accept={kind === "image" ? "image/png,image/jpeg,image/webp" : "audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm"}
            onChange={handleUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {browsing && (
        <div className="max-h-56 overflow-y-auto rounded border p-2">
          {items === null && <p className="text-xs text-slate-400">Загрузка…</p>}
          {items?.length === 0 && <p className="text-xs text-slate-400">В медиатеке пока пусто</p>}
          <ul className={kind === "image" ? "grid grid-cols-4 gap-2" : "flex flex-col gap-1.5"}>
            {items?.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(item.id);
                    setBrowsing(false);
                  }}
                  className={`w-full rounded border p-1 text-left ${item.id === assetId ? "border-blue-500 bg-blue-50" : ""}`}
                >
                  {kind === "image" ? (
                    <img src={item.url} alt={item.originalName} className="h-16 w-full rounded object-cover" />
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
    <div className="flex items-center gap-2 rounded border p-2">
      {asset.kind === "image" ? (
        <img src={asset.url} alt={asset.originalName} className="h-12 w-12 rounded object-cover" />
      ) : (
        <audio src={asset.url} controls className="h-8 flex-1" />
      )}
      <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{asset.originalName}</span>
    </div>
  );
}
