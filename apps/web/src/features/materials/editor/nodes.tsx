import { useMemo, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { ChevronDown, LayoutTemplate, Pencil, Trash2, Ungroup } from "lucide-react";
import type { ContentBlock, MaterialBlock } from "@school/shared";

import { cn } from "@/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { SimpleTooltip } from "@/shared/ui/tooltip";
import { CONTENT_BLOCK_LABELS } from "../block-factories.js";
import { FormulaEditor } from "../FormulaEditor.js";
import { ContentBlockFields } from "./block-fields.js";
import { QuestionView } from "./question-view.js";

const uid = () => crypto.randomUUID();

// ─── Формула — центрированный KaTeX, редактирование в поповере ────────────

function FormulaView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const latex = (node.attrs.latex as string) || "";
  const [open, setOpen] = useState(false);
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex || "\\;", { throwOnError: false, displayMode: true });
    } catch {
      return "";
    }
  }, [latex]);

  return (
    <NodeViewWrapper className="group/f my-2">
      <div
        className="relative rounded-md px-2 py-1.5 transition-colors hover:bg-secondary/50"
        contentEditable={false}
      >
        <div
          className="katex-render overflow-x-auto text-center text-foreground"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover/f:opacity-100">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Изменить формулу">
                <Pencil />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <FormulaEditor latex={latex} onChange={(v) => updateAttributes({ latex: v })} />
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={deleteNode}
            aria-label="Удалить формулу"
            className="hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const FormulaBlock = Node.create({
  name: "formulaBlock",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (e) => e.getAttribute("data-id"),
        renderHTML: (a) => (a.id ? { "data-id": a.id } : {}),
      },
      latex: {
        default: "",
        parseHTML: (e) => e.getAttribute("data-latex") ?? "",
        renderHTML: (a) => ({ "data-latex": a.latex }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-formula-block]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-formula-block": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FormulaView);
  },
});

// ─── Разрыв страницы ────────────────────────────────────────────────────

function PageBreakView({ deleteNode }: NodeViewProps) {
  return (
    <NodeViewWrapper className="my-3">
      <div
        className="group/pb relative flex items-center gap-3 text-[11px] uppercase tracking-wide text-text-3"
        contentEditable={false}
      >
        <span className="h-px flex-1 bg-border" />
        разрыв страницы
        <span className="h-px flex-1 bg-border" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={deleteNode}
          aria-label="Убрать разрыв"
          className="absolute right-0 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/pb:opacity-100"
        >
          <Trash2 />
        </Button>
      </div>
    </NodeViewWrapper>
  );
}

export const PageBreakBlock = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (e) => e.getAttribute("data-id"),
        renderHTML: (a) => (a.id ? { "data-id": a.id } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-page-break": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageBreakView);
  },
});

// ─── Медиа / встраивание — компактная рамка, форму рисует ContentBlockFields ─

function MediaView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const block = node.attrs.data as Extract<
    ContentBlock,
    { type: "image" | "audio" | "video" | "embed" | "table" }
  >;
  if (!block) return null;
  return (
    <NodeViewWrapper className="group/m my-2">
      <div
        className="relative rounded-lg border border-border bg-card/60 p-3"
        contentEditable={false}
      >
        <div className="mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-text-3">
          {CONTENT_BLOCK_LABELS[block.type] ?? "Медиа"}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={deleteNode}
            aria-label="Удалить блок"
            className="text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/m:opacity-100"
          >
            <Trash2 />
          </Button>
        </div>
        <ContentBlockFields
          block={block}
          onChange={(patch) => updateAttributes({ data: { ...block, ...patch } })}
        />
      </div>
    </NodeViewWrapper>
  );
}

function makeMediaNode(name: string, tag: string) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        data: {
          default: null,
          parseHTML: (e) => {
            try {
              return JSON.parse(e.getAttribute("data-json") ?? "null");
            } catch {
              return null;
            }
          },
          renderHTML: (a) => (a.data ? { "data-json": JSON.stringify(a.data) } : {}),
        },
      };
    },
    parseHTML() {
      return [{ tag: `div[${tag}]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { [tag]: "" })];
    },
    addNodeView() {
      return ReactNodeViewRenderer(MediaView);
    },
  });
}

export const ImageBlock = makeMediaNode("imageBlock", "data-image-block");
export const AudioBlock = makeMediaNode("audioBlock", "data-audio-block");
export const VideoBlock = makeMediaNode("videoBlock", "data-video-block");
export const EmbedBlock = makeMediaNode("embedBlock", "data-embed-block");
export const TableBlock = makeMediaNode("tableBlock", "data-table-block");

// ─── Врезка — цветная полоса слева, содержимое редактируется как текст ───

const CALLOUT_TONE: Record<string, string> = {
  note: "border-l-primary bg-primary-light/40",
  warning: "border-l-warning bg-warn-light/50",
  example: "border-l-success bg-success-light/40",
};
const CALLOUT_LABEL: Record<string, string> = {
  note: "Заметка",
  warning: "Внимание",
  example: "Пример",
};

function CalloutView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const variant = (node.attrs.variant as "note" | "warning" | "example") || "note";
  return (
    <NodeViewWrapper className="group/co my-2">
      <div
        className={cn(
          "relative rounded-r-md border-l-4 py-1.5 pl-3 pr-8",
          CALLOUT_TONE[variant],
        )}
      >
        <NodeViewContent className="prose-editor text-sm" />
        <div
          className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover/co:opacity-100"
          contentEditable={false}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Вид врезки">
                <Pencil />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(["note", "warning", "example"] as const).map((v) => (
                <DropdownMenuItem key={v} onSelect={() => updateAttributes({ variant: v })}>
                  {CALLOUT_LABEL[v]}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={deleteNode}
                className="text-destructive focus:text-destructive"
              >
                Удалить врезку
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const CalloutBlock = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      blockId: {
        default: null,
        parseHTML: (e) => e.getAttribute("data-block-id"),
        renderHTML: (a) => (a.blockId ? { "data-block-id": a.blockId } : {}),
      },
      variant: {
        default: "note",
        parseHTML: (e) => e.getAttribute("data-variant") ?? "note",
        renderHTML: (a) => ({ "data-variant": a.variant }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});

// ─── Спойлер — заголовок + Collapsible, содержимое редактируется как текст ─

function SpoilerView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const title = (node.attrs.title as string) || "Показать решение";
  const [open, setOpen] = useState(true); // в редакторе всегда развёрнут — методисту нужно видеть, что пишет

  return (
    <NodeViewWrapper className="group/sp my-2">
      <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border bg-card/60">
        <div
          className="flex items-center justify-between gap-2 px-3 py-1.5"
          contentEditable={false}
        >
          <CollapsibleTrigger className="flex flex-1 items-center gap-1.5 text-left text-sm font-medium text-foreground">
            <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", !open && "-rotate-90")} aria-hidden />
            <input
              value={title}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => updateAttributes({ title: e.target.value })}
              className="w-full min-w-0 bg-transparent text-sm font-medium text-foreground outline-none"
              placeholder="Заголовок спойлера"
            />
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={deleteNode}
            aria-label="Удалить спойлер"
            className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/sp:opacity-100"
          >
            <Trash2 />
          </Button>
        </div>
        <CollapsibleContent forceMount className={cn("border-t border-border px-3 py-2", !open && "hidden")}>
          <NodeViewContent className="prose-editor text-sm" />
        </CollapsibleContent>
      </Collapsible>
    </NodeViewWrapper>
  );
}

export const SpoilerBlock = Node.create({
  name: "spoiler",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      blockId: {
        default: null,
        parseHTML: (e) => e.getAttribute("data-block-id"),
        renderHTML: (a) => (a.blockId ? { "data-block-id": a.blockId } : {}),
      },
      title: {
        default: "Показать решение",
        parseHTML: (e) => e.getAttribute("data-title") ?? "Показать решение",
        renderHTML: (a) => ({ "data-title": a.title }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-spoiler]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-spoiler": "" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SpoilerView);
  },
});

// ─── Вопрос ─────────────────────────────────────────────────────────────

function jsonAttr(dataName: string) {
  const key = dataName.replace(/^data-/, "");
  return {
    default: null,
    parseHTML: (e: HTMLElement) => {
      try {
        return JSON.parse(e.getAttribute(dataName) ?? "null");
      } catch {
        return null;
      }
    },
    renderHTML: (a: Record<string, unknown>) =>
      a[key] != null ? { [dataName]: JSON.stringify(a[key]) } : {},
  };
}

export const QuestionNode = Node.create({
  name: "questionBlock",
  group: "block",
  content: "paragraph",
  defining: true,

  // Enter в формулировке вопроса — выйти абзацем ПОСЛЕ вопроса (внутри
  // одна строка формулировки; переносы не нужны, а «выбраться» из вопроса,
  // чтобы добавить блок ниже — нужно).
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { selection, schema } = this.editor.state;
        if (!(selection instanceof TextSelection) || !selection.empty) return false;
        const { $head } = selection;
        const question = $head.node(-1);
        if (!question || question.type.name !== "questionBlock") return false;
        const after = $head.after(-1);
        return this.editor
          .chain()
          .command(({ tr }) => {
            tr.insert(after, schema.nodes.paragraph!.create());
            tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
            return true;
          })
          .focus()
          .run();
      },
    };
  },

  addAttributes() {
    return {
      qid: {
        default: null,
        parseHTML: (e) => e.getAttribute("data-qid"),
        renderHTML: (a) => (a.qid ? { "data-qid": a.qid } : {}),
      },
      interaction: jsonAttr("data-interaction"),
      points: {
        default: 1,
        parseHTML: (e) => Number(e.getAttribute("data-points")) || 1,
        renderHTML: (a) => ({ "data-points": String(a.points ?? 1) }),
      },
      hint: {
        default: null,
        parseHTML: (e) => e.getAttribute("data-hint"),
        renderHTML: (a) => (a.hint ? { "data-hint": a.hint } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-question-block]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-question-block": "" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(QuestionView);
  },
});

// ─── Группа-конструкция — тонкая линия слева + метка на ховере ────────────

function TemplateGroupView({ node, editor, getPos, deleteNode }: NodeViewProps) {
  const label = (node.attrs.label as string) || "Конструкция";
  const [open, setOpen] = useState(true);

  function ungroup() {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;
    editor
      .chain()
      .focus()
      .command(({ tr, state }) => {
        const groupNode = state.doc.nodeAt(pos);
        if (!groupNode) return false;
        tr.replaceWith(pos, pos + groupNode.nodeSize, groupNode.content);
        return true;
      })
      .run();
  }

  return (
    <NodeViewWrapper className="group/tg my-2">
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="rounded-r-sm border-l-2 border-primary-muted pl-3 transition-colors hover:border-primary"
      >
        <div
          className="flex items-center justify-between gap-2 py-0.5 opacity-60 transition-opacity group-hover/tg:opacity-100"
          contentEditable={false}
        >
          <CollapsibleTrigger className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
            <ChevronDown
              className={cn("size-3 transition-transform", !open && "-rotate-90")}
              aria-hidden
            />
            <LayoutTemplate className="size-3" aria-hidden />
            {label}
          </CollapsibleTrigger>
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/tg:opacity-100">
            <SimpleTooltip content="Разгруппировать — оставить блоки">
              <Button variant="ghost" size="icon-sm" onClick={ungroup} aria-label="Разгруппировать">
                <Ungroup />
              </Button>
            </SimpleTooltip>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={deleteNode}
              aria-label="Удалить конструкцию"
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 />
            </Button>
          </span>
        </div>
        <CollapsibleContent forceMount className={cn(!open && "hidden")}>
          <NodeViewContent className="flex flex-col gap-1 pb-1" />
        </CollapsibleContent>
      </Collapsible>
    </NodeViewWrapper>
  );
}

export const TemplateGroupNode = Node.create({
  name: "templateGroup",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      groupId: {
        default: null,
        parseHTML: (e) => e.getAttribute("data-group-id"),
        renderHTML: (a) => (a.groupId ? { "data-group-id": a.groupId } : {}),
      },
      templateId: {
        default: "",
        parseHTML: (e) => e.getAttribute("data-template-id") ?? "",
        renderHTML: (a) => ({ "data-template-id": a.templateId }),
      },
      label: {
        default: "",
        parseHTML: (e) => e.getAttribute("data-label") ?? "",
        renderHTML: (a) => ({ "data-label": a.label }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-template-group]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-template-group": "" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TemplateGroupView);
  },
});

export function newBlockId(): string {
  return uid();
}

export type { MaterialBlock };
