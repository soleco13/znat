import { Extension } from "@tiptap/core";

/**
 * Глобальный атрибут `blockId` на прозаических нодах редактора-«листа» (Э13).
 * Держит стабильный id между JSON материала (`MaterialBlock.id`, тип
 * `rich_text`) и абзацем/заголовком/списком ProseMirror. `keepOnSplit: false`
 * — новый абзац по Enter не копирует id, сериализатор выдаст свежий.
 * Структурные ноды (callout / формула / вопрос / группа) держат id в своих
 * собственных атрибутах.
 */
export const PROSE_NODE_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "blockquote",
  "codeBlock",
] as const;

export const BlockId = Extension.create({
  name: "blockId",

  addGlobalAttributes() {
    return [
      {
        types: [...PROSE_NODE_TYPES],
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute("data-block-id"),
            renderHTML: (attributes) =>
              attributes.blockId ? { "data-block-id": attributes.blockId as string } : {},
          },
        },
      },
    ];
  },
});
