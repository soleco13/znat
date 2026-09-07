import StarterKit from "@tiptap/starter-kit";
import { Color, FontFamily, TextStyle } from "@tiptap/extension-text-style";
import type { AnyExtension } from "@tiptap/core";

import { BlockId } from "./block-id.js";
import {
  AudioBlock,
  CalloutBlock,
  EmbedBlock,
  FormulaBlock,
  ImageBlock,
  PageBreakBlock,
  QuestionNode,
  SpoilerBlock,
  TableBlock,
  TemplateGroupNode,
  VideoBlock,
} from "./nodes.js";

/**
 * Базовый набор расширений редактора-«листа» (Э13) — общий для самого
 * редактора и для сериализатора (`serialize.ts`, `generateJSON`/
 * `generateHTML`). Слэш-меню и placeholder добавляются только в редакторе.
 */
export function baseExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Ссылка автоссылкой (в ALLOWED_TAGS уже есть <a>), клик не уводит со страницы.
      link: { openOnClick: false },
      // Горизонтальная линия и код-блок не нужны — для «разрыва страницы»
      // отдельная нода, код-блоки в учебном материале не используются.
      horizontalRule: false,
      codeBlock: false,
    }),
    TextStyle,
    Color,
    FontFamily,
    BlockId,
    CalloutBlock,
    SpoilerBlock,
    FormulaBlock,
    PageBreakBlock,
    ImageBlock,
    AudioBlock,
    VideoBlock,
    EmbedBlock,
    TableBlock,
    QuestionNode,
    TemplateGroupNode,
  ];
}
