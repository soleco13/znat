import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { Suggestion } from "@tiptap/suggestion";
import {
  AlignLeft,
  AppWindow,
  ArrowLeftRight,
  ArrowUpDown,
  AudioLines,
  Baseline,
  CircleDot,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  LayoutTemplate,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  SeparatorHorizontal,
  Sigma,
  SquareChevronDown,
  Table as TableIcon,
  TextCursorInput,
  ToggleLeft,
  Type,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ContentBlock, QuestionInteraction } from "@school/shared";

import { cn } from "@/lib/utils";
import { createBlock } from "../block-factories.js";
import {
  MATERIAL_CONSTRUCTS,
  instantiateConstruct,
  type MaterialConstruct,
} from "../material-templates.js";
import { blockToNodes } from "./serialize.js";

interface SlashItem {
  title: string;
  group: string;
  icon: LucideIcon;
  keywords?: string;
  run: (editor: Editor, range: Range) => void;
}

function insertBlockNode(editor: Editor, range: Range, key: ContentBlock["type"] | QuestionInteraction["type"]) {
  const block = createBlock(key);
  editor.chain().focus().deleteRange(range).insertContent(blockToNodes(block)).run();
}

const CONTENT_ITEMS: SlashItem[] = [
  {
    title: "Текст",
    group: "Основное",
    icon: Type,
    keywords: "параграф абзац text",
    run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run(),
  },
  {
    title: "Заголовок 1",
    group: "Основное",
    icon: Heading1,
    keywords: "h1 title",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Заголовок 2",
    group: "Основное",
    icon: Heading2,
    keywords: "h2",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Заголовок 3",
    group: "Основное",
    icon: Heading3,
    keywords: "h3",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 3 }).run(),
  },
  {
    title: "Маркированный список",
    group: "Основное",
    icon: List,
    keywords: "bullet ul список",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    title: "Нумерованный список",
    group: "Основное",
    icon: ListOrdered,
    keywords: "ordered ol нумерация",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    title: "Цитата",
    group: "Основное",
    icon: Quote,
    keywords: "blockquote цитата",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    title: "Врезка",
    group: "Контент",
    icon: Quote,
    keywords: "callout определение заметка",
    run: (e, r) => insertBlockNode(e, r, "callout"),
  },
  {
    title: "Формула",
    group: "Контент",
    icon: Sigma,
    keywords: "latex katex формула",
    run: (e, r) => insertBlockNode(e, r, "formula"),
  },
  {
    title: "Таблица",
    group: "Контент",
    icon: TableIcon,
    run: (e, r) => insertBlockNode(e, r, "table"),
  },
  {
    title: "Изображение",
    group: "Контент",
    icon: ImageIcon,
    keywords: "картинка фото",
    run: (e, r) => insertBlockNode(e, r, "image"),
  },
  {
    title: "Аудио",
    group: "Контент",
    icon: AudioLines,
    run: (e, r) => insertBlockNode(e, r, "audio"),
  },
  {
    title: "Видео",
    group: "Контент",
    icon: Video,
    run: (e, r) => insertBlockNode(e, r, "video"),
  },
  {
    title: "Встраивание",
    group: "Контент",
    icon: AppWindow,
    keywords: "geogebra desmos",
    run: (e, r) => insertBlockNode(e, r, "embed"),
  },
  {
    title: "Разрыв страницы",
    group: "Контент",
    icon: SeparatorHorizontal,
    run: (e, r) => insertBlockNode(e, r, "page_break"),
  },
];

const QUESTION_ITEMS: SlashItem[] = (
  [
    ["single_choice", "Один правильный ответ", CircleDot],
    ["multiple_choice", "Несколько правильных ответов", ListChecks],
    ["true_false", "Верно / неверно", ToggleLeft],
    ["text_input", "Текстовый ответ", TextCursorInput],
    ["numeric_input", "Числовой ответ", Hash],
    ["open_answer", "Развёрнутый ответ", AlignLeft],
    ["cloze_dropdown", "Пропуски — выбор из списка", SquareChevronDown],
    ["cloze_text", "Пропуски — ввод текста", Baseline],
    ["matching", "Сопоставление", ArrowLeftRight],
    ["ordering", "Упорядочивание", ArrowUpDown],
  ] as [QuestionInteraction["type"], string, LucideIcon][]
).map(([type, title, icon]) => ({
  title,
  group: "Вопрос",
  icon,
  keywords: "вопрос задание question",
  run: (e: Editor, r: Range) => insertBlockNode(e, r, type),
}));

export interface SlashOptions {
  /** Открыть диалог-пикер конструкций (визуальные карточки). */
  onOpenConstructs: (insert: (construct: MaterialConstruct) => void) => void;
}

export function insertConstructAt(editor: Editor, range: Range | null, construct: MaterialConstruct) {
  const { blocks, group } = instantiateConstruct(construct);
  const content = group
    ? [
        {
          type: "templateGroup",
          attrs: { groupId: group.id, templateId: group.templateId, label: group.label },
          content: blocks.flatMap((b) => blockToNodes(b)),
        },
      ]
    : blocks.flatMap((b) => blockToNodes(b));
  const chain = editor.chain().focus();
  if (range) chain.deleteRange(range);
  chain.insertContent(content).run();
}

function buildItems(options: SlashOptions): SlashItem[] {
  const constructItems: SlashItem[] = MATERIAL_CONSTRUCTS.map((c) => ({
    title: c.label,
    group: "Конструкции урока",
    icon: c.icon,
    keywords: `${c.description} шаблон конструкция каркас`,
    run: (editor: Editor, range: Range) => insertConstructAt(editor, range, c),
  }));

  return [
    {
      title: "Все конструкции — карточками…",
      group: "Конструкции урока",
      icon: LayoutTemplate,
      keywords: "шаблон урок каркас список",
      run: (editor, range) => {
        editor.chain().focus().deleteRange(range).run();
        options.onOpenConstructs((construct) => insertConstructAt(editor, null, construct));
      },
    },
    ...constructItems,
    ...CONTENT_ITEMS,
    ...QUESTION_ITEMS,
  ];
}

// ─── React-список ──────────────────────────────────────────────────────

interface SlashListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const SlashList = forwardRef<
  SlashListHandle,
  { items: SlashItem[]; command: (item: SlashItem) => void }
>(({ items, command }, ref) => {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSelected(0), [items]);
  useLayoutEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`)?.scrollIntoView({
      block: "nearest",
    });
  }, [selected]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (event.key === "ArrowDown") {
        setSelected((s) => (s + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((s) => (s - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        const item = items[selected];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="w-64 rounded-lg border border-border bg-popover p-3 text-sm text-muted-foreground shadow-md">
        Ничего не найдено
      </div>
    );
  }

  let lastGroup = "";
  return (
    <div
      ref={listRef}
      className="max-h-[320px] w-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.map((item, idx) => {
        const header = item.group !== lastGroup ? item.group : null;
        lastGroup = item.group;
        const Icon = item.icon;
        return (
          <div key={item.title}>
            {header ? (
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                {header}
              </p>
            ) : null}
            <button
              type="button"
              data-idx={idx}
              onMouseEnter={() => setSelected(idx)}
              onClick={() => command(item)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                idx === selected ? "bg-accent text-accent-foreground" : "hover:bg-secondary",
              )}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {item.title}
            </button>
          </div>
        );
      })}
    </div>
  );
});
SlashList.displayName = "SlashList";

// ─── Extension ─────────────────────────────────────────────────────────

export const SlashCommand = Extension.create<SlashOptions>({
  name: "slashCommand",

  addOptions() {
    return { onOpenConstructs: () => undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        command: ({ editor, range, props }) => props.run(editor, range),
        items: ({ query }) => {
          const all = buildItems(options);
          const q = query.trim().toLowerCase();
          if (!q) return all;
          return all.filter(
            (i) =>
              i.title.toLowerCase().includes(q) || (i.keywords ?? "").toLowerCase().includes(q),
          );
        },
        render: () => {
          let component: ReactRenderer<SlashListHandle> | null = null;
          let unmount: (() => void) | null = null;
          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashList, {
                props: { items: props.items, command: props.command },
                editor: props.editor,
              });
              unmount = props.mount?.(component.element) ?? null;
            },
            onUpdate: (props) => {
              component?.updateProps({ items: props.items, command: props.command });
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                component?.destroy();
                return true;
              }
              return component?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: () => {
              unmount?.();
              component?.destroy();
              component = null;
            },
          };
        },
      }),
    ];
  },
});
