import type {
  AssetUrl,
  CreateMaterialResult,
  ImportedQuestionsResult,
  ListMaterialsQuery,
  Material,
  MaterialDetail,
  MaterialStatusResult,
  MaterialSummary,
  MaterialValidationIssue,
  MaterialVersionSummary,
  MediaAsset,
  MediaAssetKind,
  PublishMaterialResult,
  UpdateMaterialResult,
} from "@school/shared";
import { apiFetch } from "../../shared/api-client.js";

/** Библиотека материалов (Э9.1, §8 ТЗ). admin/methodist/teacher — ученик библиотеку не листает. */
export function listMaterials(query: ListMaterialsQuery = {}): Promise<{ items: MaterialSummary[] }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return apiFetch<{ items: MaterialSummary[] }>(`/materials${qs ? `?${qs}` : ""}`);
}

/** Материал целиком для редактора (Э9.2), с ключами ответов — только для admin/methodist/teacher-владельца. */
export function getMaterial(id: string): Promise<MaterialDetail> {
  return apiFetch<MaterialDetail>(`/materials/${id}`);
}

/** Создание материала (Э9.10, §8 ТЗ) — тело валидно по `materialSchema` целиком, собирается на клиенте из шаблона/пустого материала (`material-templates.ts`). Автор — вызывающий, всегда `draft`. */
export function createMaterial(content: Material): Promise<CreateMaterialResult> {
  return apiFetch<CreateMaterialResult>("/materials", { method: "POST", body: JSON.stringify(content) });
}

/**
 * Автосохранение (Э9.3/9.8, §8 ТЗ). Пока материал никогда не публиковался
 * — правит единственную версию на месте; если уже опубликован — правка
 * форкает (или продолжает уже форкнутую) новую версию поверх, видимую
 * школе публикацию не трогая (`updateMaterialDraft`, `materials/service.ts`).
 * `keepalive` — как и `saveResponse` (Э8.7), для отправки при уходе со
 * страницы (`visibilitychange`/`beforeunload`).
 */
export function updateMaterialDraft(
  id: string,
  content: Material,
  keepalive = false,
): Promise<UpdateMaterialResult> {
  return apiFetch<UpdateMaterialResult>(`/materials/${id}`, {
    method: "PUT",
    body: JSON.stringify(content),
    keepalive,
  });
}

/** draft → review (Э9.8) — отправить свой черновик на ревью методисту/админу. */
export function submitMaterialForReview(id: string): Promise<MaterialStatusResult> {
  return apiFetch<MaterialStatusResult>(`/materials/${id}/submit-review`, { method: "POST" });
}

/** review → draft (Э9.8) — решение ревьюера (admin/methodist), вернуть на переделку. */
export function returnMaterialToDraft(id: string): Promise<MaterialStatusResult> {
  return apiFetch<MaterialStatusResult>(`/materials/${id}/return-to-draft`, { method: "POST" });
}

/** draft|review → published, ИЛИ публикация накопившегося форка поверх уже опубликованного (Э9.8, §8 ТЗ) — admin/methodist. */
export function publishMaterial(id: string): Promise<PublishMaterialResult> {
  return apiFetch<PublishMaterialResult>(`/materials/${id}/publish`, { method: "POST" });
}

/** История версий (Э9.8, §8 ТЗ) — доступна тому, кто может редактировать материал (владелец/admin/methodist), не сторонним читателям. */
export function getMaterialVersions(id: string): Promise<{ items: MaterialVersionSummary[] }> {
  return apiFetch<{ items: MaterialVersionSummary[] }>(`/materials/${id}/versions`);
}

/** Валидатор перед публикацией (Э9.9, §7.2 ТЗ «Валидация») — вопросы без ответа, пустые блоки, нулевые баллы, битые картинки. Пустой список — материал готов к публикации. */
export function validateMaterial(id: string): Promise<{ items: MaterialValidationIssue[] }> {
  return apiFetch<{ items: MaterialValidationIssue[] }>(`/materials/${id}/validate`);
}

/** Медиатека (Э9.7, §7.2 ТЗ) — список загруженных картинок/аудио для пикера в редакторе, admin/methodist/teacher. */
export function listMediaAssets(kind?: MediaAssetKind): Promise<{ items: MediaAsset[] }> {
  return apiFetch<{ items: MediaAsset[] }>(`/materials/media${kind ? `?kind=${kind}` : ""}`);
}

/** Загрузка нового файла в медиатеку (Э9.7) — `kind` определяет сервер по MIME файла, не передаётся отдельным полем. */
export function uploadMediaAsset(file: File): Promise<MediaAsset> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<MediaAsset>("/materials/media", { method: "POST", body: formData });
}

/**
 * Полуавтоматический импорт из Word/PDF (Э9.11, §7 ТЗ) — файл в, блоки
 * `open_answer` (по одному на распознанный вопрос) обратно; ничего не
 * сохраняет на сервере — методист добавляет полученные блоки в открытый
 * в редакторе черновик отдельным действием на клиенте (`MaterialEditorPage.tsx`).
 */
export function importQuestionsFromDocument(file: File): Promise<ImportedQuestionsResult> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<ImportedQuestionsResult>("/materials/import", { method: "POST", body: formData });
}

/**
 * Резолв `assetId` (уже сохранённого в блоке материала) в подписанную
 * ссылку (§8 ТЗ `GET /assets/:id/url`) — доступен любой роли, в том числе
 * ученику, в отличие от `listMediaAssets`/`uploadMediaAsset` выше:
 * используется и живым превью редактора, и реальным плеером (оба через
 * `ContentBlockView`, `MaterialPlayer.tsx`).
 */
export function getAssetUrl(assetId: string): Promise<AssetUrl> {
  return apiFetch<AssetUrl>(`/assets/${assetId}/url`);
}
