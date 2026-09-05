import { useEffect } from "react";
import { EditorContent, type Editor, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Редактор формулировок (Э9.4, §7.2 ТЗ: «Tiptap»). Заменяет `<textarea>` с
 * сырым HTML (Э9.2/9.3) — методист форматирует текст, не пишет теги руками.
 *
 * Набор возможностей — РОВНО подмножество `ALLOWED_TAGS` из
 * `sanitize-html.ts` (`p`/`br`/`strong`/`em`/`u`/`s`/`ul`/`ol`/`li`, плюс
 * `a` автоссылкой при вставке URL — уже в `ALLOWED_TAGS`, просто без ручной
 * кнопки постановки ссылки в этой подзадаче): `heading`/`blockquote`/
 * `codeBlock`/`code`/`horizontalRule` из `StarterKit` намеренно выключены —
 * иначе редактор показывал бы форматирование, которое рендер (`sanitizeHtml`)
 * молча вырежет, что хуже отсутствия кнопки вовсе. `sub`/`sup` — тоже в
 * `ALLOWED_TAGS`, но `@tiptap/starter-kit` их не даёт, а `@tiptap/extension-
 * subscript`/`-superscript` — НЕ установлены (новая зависимость по
 * согласованию, CLAUDE.md, здесь не нужна) — отдельная подзадача при
 * необходимости.
 */
export function RichTextEditor({ html, onChange }: { html: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        // Link включён (автоссылка при вставке URL — уже в ALLOWED_TAGS), но
        // openOnClick:false — иначе клик по только что вставленной ссылке
        // прямо во время редактирования уводил бы со страницы редактора,
        // теряя невставленные автосохранением правки (Э9.3).
        link: { openOnClick: false },
      }),
    ],
    content: html,
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // Блок сменился (другой id выбран в списке слева) или контент пришёл извне
  // (загрузка материала) — editor.getHTML() тут же после onUpdate равен
  // html, так что цикл onChange → props → setContent не зацикливается.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.getHTML() !== html) editor.commands.setContent(html, { emitUpdate: false });
  }, [html, editor]);

  const toolbarState = useEditorState({
    editor,
    selector: (ctx) =>
      ctx.editor
        ? {
            bold: ctx.editor.isActive("bold"),
            italic: ctx.editor.isActive("italic"),
            underline: ctx.editor.isActive("underline"),
            strike: ctx.editor.isActive("strike"),
            bulletList: ctx.editor.isActive("bulletList"),
            orderedList: ctx.editor.isActive("orderedList"),
            canUndo: ctx.editor.can().undo(),
            canRedo: ctx.editor.can().redo(),
          }
        : null,
  });

  if (!editor || !toolbarState) return null;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15">
      <Toolbar editor={editor} state={toolbarState} />
      <EditorContent
        editor={editor}
        className="text-sm [&_.ProseMirror]:min-h-[4rem] [&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2 [&_.ProseMirror]:outline-none [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5"
      />
    </div>
  );
}

function Toolbar({
  editor,
  state,
}: {
  editor: Editor;
  state: {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    bulletList: boolean;
    orderedList: boolean;
    canUndo: boolean;
    canRedo: boolean;
  };
}) {
  return (
    <div className="flex flex-wrap gap-0.5 border-b border-border bg-secondary/50 p-1">
      <ToolbarButton
        icon={Bold}
        title="Жирный"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        icon={Italic}
        title="Курсив"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        icon={Underline}
        title="Подчёркнутый"
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      />
      <ToolbarButton
        icon={Strikethrough}
        title="Зачёркнутый"
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <span className="mx-0.5 w-px self-stretch bg-border" />
      <ToolbarButton
        icon={List}
        title="Маркированный список"
        active={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        icon={ListOrdered}
        title="Нумерованный список"
        active={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <span className="mx-0.5 w-px self-stretch bg-border" />
      <ToolbarButton
        icon={Undo2}
        title="Отменить"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!state.canUndo}
      />
      <ToolbarButton
        icon={Redo2}
        title="Повторить"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!state.canRedo}
      />
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  title,
  onClick,
  active = false,
  disabled = false,
}: {
  icon: LucideIcon;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // preventDefault — клик по кнопке не должен снимать фокус с редактора до срабатывания команды.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors disabled:opacity-30",
        active ? "bg-card text-primary shadow-xs" : "hover:bg-card hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}
