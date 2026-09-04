import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  ContentBlock,
  Material,
  MaterialBlock,
  QuestionBlock,
  QuestionInteraction,
  QuestionResponse,
} from "@school/shared";
import { stripMaterialAnswerKeys } from "@school/shared";
import { ContentBlockView } from "./MaterialPlayer.js";
import { QuestionPlayer } from "./QuestionPlayer.js";
import { getMaterial } from "./materials-api.js";

/**
 * Каркас редактора материала (Э9.2, §7.2 ТЗ: «слева — список блоков,
 * в центре — редактирование текущего блока, справа — превью глазами
 * ученика»). Пока БЕЗ:
 * - drag&drop переупорядочивания блоков (dnd-kit, Э9.3) — только выбор и
 *   добавление в конец/удаление;
 * - автосохранения (Э9.3) — черновик живёт в состоянии страницы, при
 *   обновлении страницы теряется; на сервер ничего не пишется;
 * - Tiptap/MathLive (Э9.4) — формулировки/HTML редактируются как текст в
 *   textarea, это временно и явно помечено в UI;
 * - полноценных редакторов типов вопросов 1–10 (Э9.5/9.6) — интеракция
 *   вопроса при добавлении получает валидный по форме заготовок стаб, но
 *   после этого нередактируема здесь, только `points`/`prompt`/`hint`.
 *
 * Стоп-лист Э9 («НЕ показывать методисту JSON. Никогда. Ни в каком виде»)
 * — соблюдён буквально: ни один контрол в этом файле не показывает и не
 * принимает сырой JSON (в частности `embed.config` — единственное поле
 * материала типа `Record<string, unknown>` — здесь НЕредактируемо).
 */
export function MaterialEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [material, setMaterial] = useState<Material | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getMaterial(id)
      .then((detail) => {
        if (cancelled) return;
        setMaterial(detail.material);
        setSelectedBlockId(detail.material.blocks[0]?.id ?? null);
      })
      .catch(() => !cancelled && setError("Не удалось загрузить материал"));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <div className="mx-auto mt-12 max-w-2xl px-4">
        <p className="text-sm text-red-600">{error}</p>
        <Link to="/materials" className="text-sm text-slate-500 underline">
          ← Назад в библиотеку
        </Link>
      </div>
    );
  }
  if (!material) {
    return (
      <div className="mx-auto mt-12 max-w-2xl px-4">
        <p className="text-sm text-slate-400">Загрузка…</p>
      </div>
    );
  }

  function updateBlock(blockId: string, updater: (block: MaterialBlock) => MaterialBlock) {
    setMaterial((prev) =>
      prev
        ? { ...prev, blocks: prev.blocks.map((b) => (b.id === blockId ? updater(b) : b)) }
        : prev,
    );
  }

  function addBlock(makeBlock: () => MaterialBlock) {
    const block = makeBlock();
    setMaterial((prev) => (prev ? { ...prev, blocks: [...prev.blocks, block] } : prev));
    setSelectedBlockId(block.id);
  }

  function removeBlock(blockId: string) {
    setMaterial((prev) => (prev ? { ...prev, blocks: prev.blocks.filter((b) => b.id !== blockId) } : prev));
    setSelectedBlockId((prev) => (prev === blockId ? null : prev));
  }

  const selectedBlock = material.blocks.find((b) => b.id === selectedBlockId) ?? null;

  return (
    <div className="mx-auto mt-4 max-w-7xl px-4">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <Link to="/materials" className="text-xs text-slate-500 underline">
            ← Библиотека
          </Link>
          <h1 className="text-lg font-semibold">{material.title}</h1>
        </div>
        <p className="text-xs text-amber-600">
          Черновик редактора — изменения нигде не сохраняются (автосохранение — Э9.3)
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_1fr]">
        <BlockListPanel
          blocks={material.blocks}
          selectedBlockId={selectedBlockId}
          onSelect={setSelectedBlockId}
          onAdd={addBlock}
          onRemove={removeBlock}
        />
        <BlockEditorPanel block={selectedBlock} onChange={updateBlock} />
        <LivePreviewPanel material={material} />
      </div>
    </div>
  );
}

// ─── Панель 1: список блоков ────────────────────────────────────────────────

const CONTENT_BLOCK_LABELS: Record<ContentBlock["type"], string> = {
  rich_text: "Текст",
  image: "Изображение",
  video: "Видео",
  audio: "Аудио",
  formula: "Формула",
  table: "Таблица",
  callout: "Врезка",
  embed: "Встраивание",
  page_break: "Разрыв страницы",
};

const INTERACTION_LABELS: Record<QuestionInteraction["type"], string> = {
  single_choice: "Один правильный ответ",
  multiple_choice: "Несколько правильных ответов",
  true_false: "Верно/неверно",
  text_input: "Текстовый ответ",
  numeric_input: "Числовой ответ",
  open_answer: "Развёрнутый ответ",
  cloze_dropdown: "Пропуски — выбор из списка",
  cloze_text: "Пропуски — ввод текста",
  matching: "Сопоставление",
  ordering: "Упорядочивание",
};

function blockLabel(block: MaterialBlock): string {
  return block.type === "question" ? `Вопрос: ${INTERACTION_LABELS[block.interaction.type]}` : CONTENT_BLOCK_LABELS[block.type];
}

function blockPreviewText(block: MaterialBlock): string {
  const html = block.type === "question" ? block.prompt.html : "html" in block ? block.html : "";
  const text = html.replace(/<[^>]+>/g, "").trim();
  return text || "(пусто)";
}

function BlockListPanel({
  blocks,
  selectedBlockId,
  onSelect,
  onAdd,
  onRemove,
}: {
  blocks: MaterialBlock[];
  selectedBlockId: string | null;
  onSelect: (id: string) => void;
  onAdd: (makeBlock: () => MaterialBlock) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="rounded border">
      <div className="border-b bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
        Блоки ({blocks.length})
      </div>
      <ul className="max-h-[60vh] divide-y overflow-y-auto">
        {blocks.map((block, i) => (
          <li key={block.id}>
            <button
              onClick={() => onSelect(block.id)}
              className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm ${
                block.id === selectedBlockId ? "bg-slate-100" : "hover:bg-slate-50"
              }`}
            >
              <span className="text-xs text-slate-400">
                {i + 1}. {blockLabel(block)}
              </span>
              <span className="truncate text-sm">{blockPreviewText(block)}</span>
            </button>
          </li>
        ))}
        {blocks.length === 0 && (
          <li className="px-3 py-4 text-center text-xs text-slate-400">Материал пуст — добавьте первый блок</li>
        )}
      </ul>
      {selectedBlockId && (
        <button
          onClick={() => onRemove(selectedBlockId)}
          className="w-full border-t px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
        >
          Удалить выбранный блок
        </button>
      )}
      <AddBlockMenu onAdd={onAdd} />
    </div>
  );
}

function AddBlockMenu({ onAdd }: { onAdd: (makeBlock: () => MaterialBlock) => void }) {
  return (
    <div className="border-t p-2">
      <label className="block text-xs text-slate-500">
        Добавить блок
        <select
          value=""
          onChange={(e) => {
            const key = e.target.value;
            if (key) onAdd(() => createBlock(key as ContentBlock["type"] | QuestionInteraction["type"]));
          }}
          className="mt-1 block w-full rounded border px-2 py-1 text-sm"
        >
          <option value="" disabled>
            Выберите тип…
          </option>
          <optgroup label="Контент">
            {(Object.keys(CONTENT_BLOCK_LABELS) as ContentBlock["type"][]).map((t) => (
              <option key={t} value={t}>
                {CONTENT_BLOCK_LABELS[t]}
              </option>
            ))}
          </optgroup>
          <optgroup label="Вопрос">
            {(Object.keys(INTERACTION_LABELS) as QuestionInteraction["type"][]).map((t) => (
              <option key={t} value={t}>
                {INTERACTION_LABELS[t]}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
    </div>
  );
}

function createBlock(key: ContentBlock["type"] | QuestionInteraction["type"]): MaterialBlock {
  const id = crypto.randomUUID();
  if (key in CONTENT_BLOCK_LABELS) return createContentBlock(key as ContentBlock["type"], id);
  return createQuestionBlock(key as QuestionInteraction["type"], id);
}

function createContentBlock(type: ContentBlock["type"], id: string): ContentBlock {
  switch (type) {
    case "rich_text":
      return { type, id, html: "" };
    case "image":
      return { type, id, assetId: "", zoomable: false };
    case "video":
      return { type, id, assetId: "" };
    case "audio":
      return { type, id, assetId: "" };
    case "formula":
      return { type, id, latex: "" };
    case "table":
      return { type, id, rows: [["", ""]] };
    case "callout":
      return { type, id, variant: "note", html: "" };
    case "embed":
      return { type, id, provider: "geogebra", config: {} };
    case "page_break":
      return { type, id };
  }
}

function createQuestionBlock(interactionType: QuestionInteraction["type"], id: string): QuestionBlock {
  return {
    type: "question",
    id,
    prompt: { html: "" },
    points: 1,
    interaction: createInteraction(interactionType),
  };
}

function createInteraction(type: QuestionInteraction["type"]): QuestionInteraction {
  switch (type) {
    case "single_choice":
    case "multiple_choice":
      return {
        type,
        shuffle: false,
        options: [
          { id: crypto.randomUUID(), html: "", correct: type === "single_choice" },
          { id: crypto.randomUUID(), html: "", correct: false },
        ],
      };
    case "true_false":
      return { type, correct: true };
    case "text_input":
      return {
        type,
        answers: [{ value: "", match: "exact" }],
        caseSensitive: false,
        trimWhitespace: true,
        typoTolerance: 0,
      };
    case "numeric_input":
      return { type, value: 0, tolerance: { kind: "absolute", value: 0 }, unitRequired: false };
    case "open_answer":
      return {
        type,
        maxLength: 500,
        allowAttachments: false,
        rubric: [{ id: crypto.randomUUID(), label: "", points: 1 }],
      };
    case "cloze_dropdown":
      return { type, template: "", gaps: {} };
    case "cloze_text":
      return { type, template: "", gaps: {} };
    case "matching":
      return {
        type,
        left: [{ id: crypto.randomUUID(), html: "" }],
        right: [{ id: crypto.randomUUID(), html: "" }],
        pairs: [],
        scoring: "all_or_nothing",
        distractors: [],
      };
    case "ordering":
      return {
        type,
        items: [
          { id: crypto.randomUUID(), html: "" },
          { id: crypto.randomUUID(), html: "" },
        ],
      };
  }
}

// ─── Панель 2: редактирование выбранного блока ──────────────────────────────

function BlockEditorPanel({
  block,
  onChange,
}: {
  block: MaterialBlock | null;
  onChange: (blockId: string, updater: (b: MaterialBlock) => MaterialBlock) => void;
}) {
  if (!block) {
    return (
      <div className="rounded border p-4 text-sm text-slate-400">Выберите блок слева, чтобы его редактировать</div>
    );
  }

  function set<B extends MaterialBlock>(patch: Partial<B>) {
    onChange(block!.id, (b) => ({ ...b, ...patch }) as MaterialBlock);
  }

  return (
    <div className="rounded border p-4">
      <h2 className="mb-3 text-sm font-medium text-slate-600">{blockLabel(block)}</h2>
      {block.type === "question" ? (
        <QuestionBlockFields block={block} onChange={(patch) => set(patch)} />
      ) : (
        <ContentBlockFields block={block} onChange={(patch) => set(patch)} />
      )}
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="block text-xs text-slate-500">
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="mt-1 block w-full rounded border px-2 py-1 text-sm"
      />
      {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs text-slate-500">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded border px-2 py-1 text-sm"
      />
    </label>
  );
}

function ContentBlockFields({
  block,
  onChange,
}: {
  block: ContentBlock;
  onChange: (patch: Partial<ContentBlock>) => void;
}) {
  switch (block.type) {
    case "rich_text":
      return (
        <TextAreaField
          label="Текст (HTML)"
          value={block.html}
          onChange={(html) => onChange({ html })}
          hint="Временно — редактор Tiptap появится в Э9.4"
        />
      );
    case "callout":
      return (
        <div className="flex flex-col gap-3">
          <label className="block text-xs text-slate-500">
            Вид врезки
            <select
              value={block.variant}
              onChange={(e) => onChange({ variant: e.target.value as typeof block.variant })}
              className="mt-1 block w-full rounded border px-2 py-1 text-sm"
            >
              <option value="note">Заметка</option>
              <option value="warning">Внимание</option>
              <option value="example">Пример</option>
            </select>
          </label>
          <TextAreaField label="Текст (HTML)" value={block.html} onChange={(html) => onChange({ html })} />
        </div>
      );
    case "image":
      return (
        <div className="flex flex-col gap-3">
          <TextField label="id файла в медиатеке" value={block.assetId} onChange={(assetId) => onChange({ assetId })} />
          <TextField label="Подпись" value={block.caption ?? ""} onChange={(caption) => onChange({ caption })} />
          <p className="text-[11px] text-slate-400">Загрузка из медиатеки — Э9.7</p>
        </div>
      );
    case "video":
      return (
        <div className="flex flex-col gap-3">
          <TextField label="id файла в медиатеке" value={block.assetId} onChange={(assetId) => onChange({ assetId })} />
          <p className="text-[11px] text-slate-400">Загрузка из медиатеки — Э9.7</p>
        </div>
      );
    case "audio":
      return (
        <div className="flex flex-col gap-3">
          <TextField label="id файла в медиатеке" value={block.assetId} onChange={(assetId) => onChange({ assetId })} />
          <TextAreaField
            label="Транскрипт"
            value={block.transcript ?? ""}
            onChange={(transcript) => onChange({ transcript })}
          />
          <p className="text-[11px] text-slate-400">Загрузка из медиатеки — Э9.7</p>
        </div>
      );
    case "formula":
      return (
        <TextField label="LaTeX" value={block.latex} onChange={(latex) => onChange({ latex })} />
      );
    case "table": {
      const rowsText = block.rows.map((r) => r.join(" | ")).join("\n");
      return (
        <TextAreaField
          label="Таблица (строка на строку, ячейки через « | »)"
          value={rowsText}
          onChange={(text) =>
            onChange({ rows: text.split("\n").map((line) => line.split("|").map((cell) => cell.trim())) })
          }
        />
      );
    }
    case "embed":
      return (
        <div className="flex flex-col gap-3">
          <label className="block text-xs text-slate-500">
            Провайдер
            <select
              value={block.provider}
              onChange={(e) => onChange({ provider: e.target.value as typeof block.provider })}
              className="mt-1 block w-full rounded border px-2 py-1 text-sm"
            >
              <option value="geogebra">GeoGebra</option>
              <option value="desmos">Desmos</option>
              <option value="jsxgraph">JSXGraph</option>
            </select>
          </label>
          <p className="text-[11px] text-slate-400">Настройка встраивания — появится отдельно</p>
        </div>
      );
    case "page_break":
      return <p className="text-xs text-slate-400">Разрыв страницы — настраивать нечего</p>;
  }
}

function QuestionBlockFields({
  block,
  onChange,
}: {
  block: QuestionBlock;
  onChange: (patch: Partial<QuestionBlock>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <TextAreaField
        label="Формулировка вопроса (HTML)"
        value={block.prompt.html}
        onChange={(html) => onChange({ prompt: { html } })}
        hint="Временно — редактор Tiptap/MathLive появится в Э9.4"
      />
      <label className="block text-xs text-slate-500">
        Баллы
        <input
          type="number"
          min={0}
          value={block.points}
          onChange={(e) => onChange({ points: Number(e.target.value) || 0 })}
          className="mt-1 block w-24 rounded border px-2 py-1 text-sm"
        />
      </label>
      <TextAreaField
        label="Подсказка (необязательно)"
        value={block.hint?.html ?? ""}
        onChange={(html) => onChange({ hint: html ? { html } : undefined })}
      />
      <div className="rounded border border-dashed p-2 text-xs text-slate-500">
        Тип: {INTERACTION_LABELS[block.interaction.type]}
        <br />
        Варианты ответа/ключ редактируются в редакторе вопроса — Э9.5/Э9.6.
      </div>
    </div>
  );
}

// ─── Панель 3: живое превью глазами ученика ─────────────────────────────────

function LivePreviewPanel({ material }: { material: Material }) {
  const [responses, setResponses] = useState<Record<string, QuestionResponse>>({});
  const publicMaterial = stripMaterialAnswerKeys(material, "editor-preview");

  return (
    <div className="rounded border">
      <div className="border-b bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">Превью глазами ученика</div>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3">
        <h3 className="text-base font-semibold">{material.title}</h3>
        {publicMaterial.blocks.map((block) =>
          block.type === "question" ? (
            <QuestionPlayer
              key={block.id}
              block={block}
              value={responses[block.id]}
              onChange={(r) => setResponses((prev) => ({ ...prev, [block.id]: r }))}
            />
          ) : (
            <ContentBlockView key={block.id} block={block} />
          ),
        )}
        {publicMaterial.blocks.length === 0 && <p className="text-sm text-slate-400">Материал пуст</p>}
      </div>
    </div>
  );
}
