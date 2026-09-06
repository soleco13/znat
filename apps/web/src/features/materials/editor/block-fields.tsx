import { useState } from "react";
import type { ContentBlock, QuestionBlock } from "@school/shared";

import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import { INTERACTION_LABELS } from "../block-factories.js";
import { FormulaEditor } from "../FormulaEditor.js";
import { MediaAssetPicker } from "../MediaAssetPicker.js";
import { InteractionEditor } from "../QuestionInteractionEditors.js";
import { RichTextEditor } from "../RichTextEditor.js";

/**
 * Формы редактирования структурных блоков — общие для нод-вью редактора-«листа»
 * (Э13). Вынесены из `MaterialEditorPage`. Логика типов вопросов
 * (`InteractionEditor`) и формул (`FormulaEditor`) не тронута.
 */

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-muted-foreground">{children}</span>;
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
    </label>
  );
}

export function CalloutVariantSelect({
  value,
  onChange,
}: {
  value: "note" | "warning" | "example";
  onChange: (v: "note" | "warning" | "example") => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as typeof value)}>
      <SelectTrigger className="h-7 w-36 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="note">Заметка</SelectItem>
        <SelectItem value="warning">Внимание</SelectItem>
        <SelectItem value="example">Пример</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Формы для картинки / аудио / видео / формулы / встраивания / таблицы — без обёртки. */
export function ContentBlockFields({
  block,
  onChange,
}: {
  block: ContentBlock;
  onChange: (patch: Partial<ContentBlock>) => void;
}) {
  switch (block.type) {
    case "rich_text":
      return <RichTextEditor html={block.html} onChange={(html) => onChange({ html })} />;
    case "callout":
      return <RichTextEditor html={block.html} onChange={(html) => onChange({ html })} />;
    case "image":
      return (
        <div className="flex flex-col gap-3">
          <MediaAssetPicker
            kind="image"
            assetId={block.assetId}
            onChange={(assetId) => onChange({ assetId })}
          />
          <TextField
            label="Подпись"
            value={block.caption ?? ""}
            onChange={(caption) => onChange({ caption })}
          />
        </div>
      );
    case "audio":
      return (
        <div className="flex flex-col gap-3">
          <MediaAssetPicker
            kind="audio"
            assetId={block.assetId}
            onChange={(assetId) => onChange({ assetId })}
          />
          <TextAreaField
            label="Транскрипт"
            value={block.transcript ?? ""}
            onChange={(transcript) => onChange({ transcript })}
          />
        </div>
      );
    case "video":
      return (
        <div className="flex flex-col gap-2">
          <TextField
            label="Ссылка на видео"
            value={block.assetId}
            onChange={(assetId) => onChange({ assetId })}
          />
          <p className="text-[11px] text-muted-foreground">
            Загрузка видео в медиатеку появится позже — пока укажите ссылку.
          </p>
        </div>
      );
    case "formula":
      return <FormulaEditor latex={block.latex} onChange={(latex) => onChange({ latex })} />;
    case "table": {
      const rowsText = block.rows.map((r) => r.join(" | ")).join("\n");
      return (
        <TextAreaField
          label="Таблица (строка на строку, ячейки через « | »)"
          value={rowsText}
          onChange={(text) =>
            onChange({
              rows: text.split("\n").map((line) => line.split("|").map((cell) => cell.trim())),
            })
          }
        />
      );
    }
    case "embed":
      return (
        <label className="flex flex-col gap-1.5">
          <FieldLabel>Провайдер</FieldLabel>
          <Select
            value={block.provider}
            onValueChange={(v) => onChange({ provider: v as typeof block.provider })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="geogebra">GeoGebra</SelectItem>
              <SelectItem value="desmos">Desmos</SelectItem>
              <SelectItem value="jsxgraph">JSXGraph</SelectItem>
            </SelectContent>
          </Select>
        </label>
      );
    case "page_break":
      return null;
  }
}

export function QuestionBlockFields({
  block,
  onChange,
}: {
  block: QuestionBlock;
  onChange: (patch: Partial<QuestionBlock>) => void;
}) {
  const [advanced, setAdvanced] = useState(Boolean(block.hint?.html));
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <FieldLabel>Формулировка вопроса</FieldLabel>
        <RichTextEditor html={block.prompt.html} onChange={(html) => onChange({ prompt: { html } })} />
      </label>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">
          Ответ · {INTERACTION_LABELS[block.interaction.type]}
        </p>
        <InteractionEditor
          interaction={block.interaction}
          onChange={(interaction) => onChange({ interaction })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <FieldLabel>Баллы</FieldLabel>
          <Input
            type="number"
            min={0}
            value={block.points}
            onChange={(e) => onChange({ points: Number(e.target.value) || 0 })}
            className="h-8 w-20"
          />
        </label>
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="text-xs font-medium text-primary hover:underline"
        >
          {advanced ? "Скрыть подсказку" : "Добавить подсказку"}
        </button>
      </div>

      {advanced ? (
        <label className="flex flex-col gap-1.5">
          <FieldLabel>Подсказка (необязательно)</FieldLabel>
          <RichTextEditor
            html={block.hint?.html ?? ""}
            onChange={(html) => onChange({ hint: html ? { html } : undefined })}
          />
        </label>
      ) : null}
    </div>
  );
}
