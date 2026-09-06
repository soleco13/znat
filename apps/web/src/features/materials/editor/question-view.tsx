import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Check, MoreHorizontal, Plus, Settings2, Trash2, X } from "lucide-react";
import type { QuestionInteraction } from "@school/shared";

import { cn } from "@/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import { INTERACTION_LABELS } from "../block-factories.js";
import { InteractionEditor } from "../QuestionInteractionEditors.js";

const uid = () => crypto.randomUUID();
const stripTags = (s: string) => s.replace(/<[^>]+>/g, "");

function pointsLabel(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "балл";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "балла";
  return "баллов";
}

/**
 * Нод-вью вопроса (Э13) — вписан в документ как в Notion: формулировка —
 * обычный редактируемый текст (`NodeViewContent`, та же панель форматирования),
 * варианты ответа — компактный список без рамок-коробок, баллы и настройки
 * — в поповерах. Никакой матрёшки редакторов.
 */
export function QuestionView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const interaction = node.attrs.interaction as QuestionInteraction | null;
  const points = (node.attrs.points as number) ?? 1;
  const hint = (node.attrs.hint as string | null) ?? null;
  if (!interaction) return null;

  const setInteraction = (next: QuestionInteraction) => updateAttributes({ interaction: next });

  return (
    <NodeViewWrapper className="group/q my-2">
      <div className="rounded-md border-l-2 border-primary-muted/70 pl-3 transition-colors focus-within:border-primary hover:border-primary-muted">
        <div
          className="flex items-center gap-2 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary/70"
          contentEditable={false}
        >
          {INTERACTION_LABELS[interaction.type]}
        </div>

        <NodeViewContent className="prose-editor mt-0.5 text-[15px] font-medium" />

        <div className="mt-1.5" contentEditable={false}>
          <AnswerArea interaction={interaction} onChange={setInteraction} />
        </div>

        <div
          className="mt-2 flex items-center gap-2 pb-0.5 text-xs text-muted-foreground"
          contentEditable={false}
        >
          <PointsChip value={points} onChange={(p) => updateAttributes({ points: p })} />
          <MoreMenu hint={hint} onHint={(h) => updateAttributes({ hint: h })} onDelete={deleteNode} />
        </div>
      </div>
    </NodeViewWrapper>
  );
}

function AnswerArea({
  interaction,
  onChange,
}: {
  interaction: QuestionInteraction;
  onChange: (i: QuestionInteraction) => void;
}) {
  switch (interaction.type) {
    case "single_choice":
    case "multiple_choice":
      return (
        <ChoiceInline
          interaction={interaction}
          onChange={onChange}
          multiple={interaction.type === "multiple_choice"}
        />
      );
    case "true_false":
      return <TrueFalseInline interaction={interaction} onChange={onChange} />;
    case "text_input":
      return <TextInline interaction={interaction} onChange={onChange} />;
    case "numeric_input":
      return <NumericInline interaction={interaction} onChange={onChange} />;
    default:
      return <ComplexInline interaction={interaction} onChange={onChange} />;
  }
}

function ChoiceInline({
  interaction,
  onChange,
  multiple,
}: {
  interaction: Extract<QuestionInteraction, { type: "single_choice" | "multiple_choice" }>;
  onChange: (i: QuestionInteraction) => void;
  multiple: boolean;
}) {
  const opts = interaction.options;

  function setText(id: string, text: string) {
    onChange({ ...interaction, options: opts.map((o) => (o.id === id ? { ...o, html: text } : o)) });
  }
  function toggleCorrect(id: string) {
    if (multiple) {
      onChange({
        ...interaction,
        options: opts.map((o) => (o.id === id ? { ...o, correct: !o.correct } : o)),
      });
    } else {
      onChange({ ...interaction, options: opts.map((o) => ({ ...o, correct: o.id === id })) });
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      {opts.map((o) => (
        <div key={o.id} className="group/opt flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggleCorrect(o.id)}
            aria-label={o.correct ? "Верный вариант" : "Отметить верным"}
            className={cn(
              "flex size-4 shrink-0 items-center justify-center border transition-colors",
              multiple ? "rounded-[4px]" : "rounded-full",
              o.correct
                ? "border-success bg-success text-white"
                : "border-muted-foreground/40 hover:border-foreground",
            )}
          >
            {o.correct ? <Check className="size-3" strokeWidth={3} /> : null}
          </button>
          <input
            value={stripTags(o.html)}
            onChange={(e) => setText(o.id, e.target.value)}
            placeholder="Вариант ответа"
            className="flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground/60"
          />
          {opts.length > 2 ? (
            <button
              type="button"
              onClick={() =>
                onChange({ ...interaction, options: opts.filter((x) => x.id !== o.id) })
              }
              aria-label="Убрать вариант"
              className="text-muted-foreground/40 opacity-0 transition-opacity hover:text-destructive group-hover/opt:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange({
            ...interaction,
            options: [...opts, { id: uid(), html: "", correct: false }],
          })
        }
        className="mt-0.5 flex items-center gap-2 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="flex size-4 items-center justify-center">
          <Plus className="size-3.5" />
        </span>
        добавить вариант
      </button>
    </div>
  );
}

function TrueFalseInline({
  interaction,
  onChange,
}: {
  interaction: Extract<QuestionInteraction, { type: "true_false" }>;
  onChange: (i: QuestionInteraction) => void;
}) {
  return (
    <div className="flex gap-2">
      {[true, false].map((v) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange({ ...interaction, correct: v })}
          className={cn(
            "rounded-md border px-3 py-1 text-sm transition-colors",
            interaction.correct === v
              ? "border-success bg-success-light font-medium text-success"
              : "border-border hover:bg-secondary",
          )}
        >
          {v ? "Верно" : "Неверно"}
        </button>
      ))}
    </div>
  );
}

function TextInline({
  interaction,
  onChange,
}: {
  interaction: Extract<QuestionInteraction, { type: "text_input" }>;
  onChange: (i: QuestionInteraction) => void;
}) {
  const answers = interaction.answers;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="w-56 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground/70">
        поле для ответа ученика
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Правильные:</span>
        {answers.map((a, i) => (
          <span
            key={i}
            className="group/a inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5"
          >
            <input
              value={a.value}
              onChange={(e) =>
                onChange({
                  ...interaction,
                  answers: answers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                })
              }
              placeholder="ответ"
              className="w-20 bg-transparent outline-none"
            />
            {answers.length > 1 ? (
              <button
                type="button"
                onClick={() =>
                  onChange({ ...interaction, answers: answers.filter((_, j) => j !== i) })
                }
                className="text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover/a:opacity-100"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({
              ...interaction,
              answers: [...answers, { value: "", match: "normalized" }],
            })
          }
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="mr-0.5 inline size-3" />
          ещё
        </button>
      </div>
    </div>
  );
}

function NumericInline({
  interaction,
  onChange,
}: {
  interaction: Extract<QuestionInteraction, { type: "numeric_input" }>;
  onChange: (i: QuestionInteraction) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-1.5 text-muted-foreground">
        ответ
        <Input
          type="number"
          value={interaction.value}
          onChange={(e) => onChange({ ...interaction, value: Number(e.target.value) || 0 })}
          className="h-7 w-24"
        />
      </label>
      <label className="flex items-center gap-1.5 text-muted-foreground">
        допуск ±
        <Input
          type="number"
          min={0}
          value={interaction.tolerance.value}
          onChange={(e) =>
            onChange({
              ...interaction,
              tolerance: { ...interaction.tolerance, value: Number(e.target.value) || 0 },
            })
          }
          className="h-7 w-20"
        />
      </label>
      <Select
        value={interaction.tolerance.kind}
        onValueChange={(v) =>
          onChange({
            ...interaction,
            tolerance: { ...interaction.tolerance, kind: v as "absolute" | "relative" | "percent" },
          })
        }
      >
        <SelectTrigger className="h-7 w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="absolute">абсолютный</SelectItem>
          <SelectItem value="relative">относительный</SelectItem>
          <SelectItem value="percent">проценты</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function ComplexInline({
  interaction,
  onChange,
}: {
  interaction: QuestionInteraction;
  onChange: (i: QuestionInteraction) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="size-3.5" />
          Настроить ответ
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[65vh] w-[26rem] overflow-y-auto">
        <InteractionEditor interaction={interaction} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

function PointsChip({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-full bg-secondary px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-accent"
        >
          {value} {pointsLabel(value)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          Баллы за вопрос
          <Input
            type="number"
            min={0}
            value={value}
            onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
      </PopoverContent>
    </Popover>
  );
}

function MoreMenu({
  hint,
  onHint,
  onDelete,
}: {
  hint: string | null;
  onHint: (h: string | null) => void;
  onDelete: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Ещё"
          className="rounded p-0.5 transition-colors hover:bg-secondary hover:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          Подсказка ученику
          <Textarea
            value={hint ?? ""}
            onChange={(e) => onHint(e.target.value.trim() ? e.target.value : null)}
            rows={2}
            placeholder="Необязательно"
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
          Удалить вопрос
        </Button>
      </PopoverContent>
    </Popover>
  );
}
