import { useEffect, type CSSProperties } from "react";
import { EditorContent, type Editor, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

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
    <div className="rounded border">
      <Toolbar editor={editor} state={toolbarState} />
      <EditorContent
        editor={editor}
        className="text-sm [&_.ProseMirror]:min-h-[4rem] [&_.ProseMirror]:px-2 [&_.ProseMirror]:py-1.5 [&_.ProseMirror]:outline-none [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5"
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
    <div className="flex flex-wrap gap-1 border-b bg-slate-50 p-1">
      <ToolbarButton
        label="Ж"
        title="Жирный"
        style={{ fontWeight: 700 }}
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        label="К"
        title="Курсив"
        style={{ fontStyle: "italic" }}
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        label="Ч"
        title="Подчёркнутый"
        style={{ textDecoration: "underline" }}
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      />
      <ToolbarButton
        label="З"
        title="Зачёркнутый"
        style={{ textDecoration: "line-through" }}
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <ToolbarButton
        label="•"
        title="Маркированный список"
        active={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        label="1."
        title="Нумерованный список"
        active={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton label="↶" title="Отменить" onClick={() => editor.chain().focus().undo().run()} disabled={!state.canUndo} />
      <ToolbarButton label="↷" title="Повторить" onClick={() => editor.chain().focus().redo().run()} disabled={!state.canRedo} />
    </div>
  );
}

function ToolbarButton({
  label,
  title,
  onClick,
  active = false,
  disabled = false,
  style,
}: {
  label: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // preventDefault — клик по кнопке не должен снимать фокус/выделение с редактора до срабатывания команды.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={style}
      className={`min-w-6 rounded border px-1.5 py-0.5 text-xs disabled:opacity-30 ${
        active ? "border-slate-400 bg-slate-200" : "hover:bg-slate-100"
      }`}
    >
      {label}
    </button>
  );
}
