import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Placeholder } from "@tiptap/extensions/placeholder";
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Strikethrough,
  Type,
  Underline,
} from "lucide-react";
import type { Material } from "@school/shared";

import { cn } from "@/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Separator } from "@/shared/ui/separator";
import type { MaterialConstruct } from "../material-templates.js";
import { baseExtensions } from "./extensions.js";
import { ConstructPickerDialog } from "./construct-picker.js";
import { docToMaterial, materialToDoc } from "./serialize.js";
import { SlashCommand } from "./slash-menu.js";
import "./editor.css";

const FONTS = [
  { label: "Обычный", value: null },
  { label: "С засечками", value: "Georgia, 'Times New Roman', serif" },
  { label: "Моноширинный", value: "ui-monospace, 'SF Mono', Menlo, monospace" },
];

const COLORS = [
  { label: "Обычный", value: null },
  { label: "Синий", value: "#1d4ed8" },
  { label: "Зелёный", value: "#15803d" },
  { label: "Красный", value: "#b91c1c" },
  { label: "Оранжевый", value: "#c2410c" },
  { label: "Серый", value: "#6b7280" },
];

const SAVE_DEBOUNCE_MS = 600;

/**
 * Редактор материала как один документ Tiptap (Э13). Печатаешь как в
 * заметках; «/» — меню блоков и конструкций; выделение текста — плавающая
 * панель форматирования (шрифт, цвет, заголовки, списки). Сериализация в
 * `Material.blocks`/`groups` — `serialize.ts`.
 */
export function MaterialDocEditor({
  material,
  onChange,
}: {
  material: Material;
  onChange: (m: Material) => void;
}) {
  const [constructInsert, setConstructInsert] = useState<
    ((c: MaterialConstruct) => void) | null
  >(null);

  const materialRef = useRef(material);
  materialRef.current = material;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback((editor: Editor) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onChangeRef.current(docToMaterial(editor.getJSON(), materialRef.current));
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const editor = useEditor({
    extensions: [
      ...baseExtensions(),
      Placeholder.configure({
        includeChildren: true,
        placeholder: ({ editor, node, pos }) => {
          if (node.type.name === "heading") return "Заголовок";
          try {
            const parent = editor.state.doc.resolve(pos).parent;
            if (parent.type.name === "questionBlock") return "Текст вопроса";
            if (parent.type.name === "callout") return "Текст врезки";
          } catch {
            /* позиция могла измениться — не критично */
          }
          return "Пишите или «/» — блок или конструкция урока";
        },
      }),
      SlashCommand.configure({
        onOpenConstructs: (insert) => setConstructInsert(() => insert),
      }),
    ],
    content: materialToDoc(material),
    editorProps: {
      attributes: { class: "prose-editor min-h-[60vh] focus:outline-none" },
    },
    onUpdate: ({ editor }) => scheduleSave(editor),
    // Материал большой правится редко, история в памяти достаточна.
    immediatelyRender: false,
  });

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      // сбросить накопленный черновик перед размонтированием
      if (editor && !editor.isDestroyed) {
        onChangeRef.current(docToMaterial(editor.getJSON(), materialRef.current));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  function onPickConstruct(construct: MaterialConstruct) {
    constructInsert?.(construct);
    setConstructInsert(null);
  }

  if (!editor) return null;

  return (
    <div className="mx-auto w-full max-w-[720px] pb-40">
      <BubbleMenu
        editor={editor}
        options={{ placement: "top", offset: 8 }}
        shouldShow={({ editor, state }) => {
          const { from, to, empty } = state.selection;
          return !empty && from !== to && editor.isEditable;
        }}
      >
        <FormatBar editor={editor} />
      </BubbleMenu>

      <EditorContent editor={editor} />

      <ConstructPickerDialog
        open={constructInsert !== null}
        onOpenChange={(o) => !o && setConstructInsert(null)}
        onPick={onPickConstruct}
      />
    </div>
  );
}

function FormatBar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      h2: editor.isActive("heading", { level: 2 }),
      h3: editor.isActive("heading", { level: 3 }),
      bullet: editor.isActive("bulletList"),
      ordered: editor.isActive("orderedList"),
      link: editor.isActive("link"),
    }),
  });

  function setLink() {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Ссылка", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-md">
      <BarButton active={state.bold} label="Жирный" onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold />
      </BarButton>
      <BarButton active={state.italic} label="Курсив" onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic />
      </BarButton>
      <BarButton
        active={state.underline}
        label="Подчёркнутый"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline />
      </BarButton>
      <BarButton
        active={state.strike}
        label="Зачёркнутый"
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </BarButton>

      <Separator orientation="vertical" className="mx-0.5 h-5" />

      <BarButton
        active={state.h2}
        label="Заголовок"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 />
      </BarButton>
      <BarButton
        active={state.h3}
        label="Малый заголовок"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 />
      </BarButton>
      <BarButton
        active={state.bullet}
        label="Список"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List />
      </BarButton>
      <BarButton
        active={state.ordered}
        label="Нумерованный список"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </BarButton>
      <BarButton active={state.link} label="Ссылка" onClick={setLink}>
        <Link2 />
      </BarButton>

      <Separator orientation="vertical" className="mx-0.5 h-5" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Шрифт">
            <Type />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {FONTS.map((f) => (
            <DropdownMenuItem
              key={f.label}
              onSelect={() =>
                f.value
                  ? editor.chain().focus().setFontFamily(f.value).run()
                  : editor.chain().focus().unsetFontFamily().run()
              }
            >
              <span style={f.value ? { fontFamily: f.value } : undefined}>{f.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Цвет текста">
            <span className="size-3.5 rounded-full border border-border bg-gradient-to-br from-primary to-success" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {COLORS.map((c) => (
            <DropdownMenuItem
              key={c.label}
              onSelect={() =>
                c.value
                  ? editor.chain().focus().setColor(c.value).run()
                  : editor.chain().focus().unsetColor().run()
              }
            >
              <span
                className="size-3.5 rounded-full border border-border"
                style={{ background: c.value ?? "var(--foreground, #111)" }}
              />
              {c.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function BarButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(active && "bg-accent text-accent-foreground")}
    >
      {children}
    </Button>
  );
}
