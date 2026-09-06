import { generateHTML, generateJSON, type JSONContent } from "@tiptap/core";
import type {
  Material,
  MaterialBlock,
  MaterialBlockGroup,
  QuestionInteraction,
} from "@school/shared";

import { baseExtensions } from "./extensions.js";
import { newBlockId } from "./nodes.js";

/**
 * Материал ⇄ документ ProseMirror (Э13, редактор-«лист»). Формат хранения —
 * прежний `Material.blocks` (плоский список, от него зависят бэкенд, движок
 * проверки, плеер); редактор же работает с ОДНИМ документом Tiptap.
 *
 * - прозаические блоки (`rich_text`) ⇄ нативные абзацы/заголовки/списки;
 * - `callout` ⇄ нода `callout` с редактируемым содержимым;
 * - `formula`/`page_break` ⇄ атом-ноды;
 * - `image`/`audio`/`video`/`embed`/`table` ⇄ атом-ноды, весь блок в `data`;
 * - `question` ⇄ атом-нода, весь `QuestionBlock` в `data`;
 * - `material.groups` ⇄ нода-контейнер `templateGroup`.
 */

// Схема тяжеловата для пересборки на каждый вызов — кешируем массив расширений.
let cachedExtensions: ReturnType<typeof baseExtensions> | null = null;
function ext() {
  cachedExtensions ??= baseExtensions();
  return cachedExtensions;
}

function isEmptyHtml(html: string): boolean {
  return html.replace(/<[^>]+>/g, "").trim() === "" && !/<(img|hr|br)\b/i.test(html);
}

function stripEditorAttrs(html: string): string {
  return html.replace(/\s+data-block-id="[^"]*"/g, "");
}

// ─── Material → JSONContent ─────────────────────────────────────────────

export function materialToDoc(material: Material): JSONContent {
  const groupByBlockId = new Map<string, MaterialBlockGroup>();
  for (const g of material.groups ?? []) {
    for (const bid of g.blockIds) groupByBlockId.set(bid, g);
  }

  const content: JSONContent[] = [];
  const emitted = new Set<string>();

  for (const block of material.blocks) {
    const group = groupByBlockId.get(block.id);
    if (group) {
      if (emitted.has(group.id)) continue;
      emitted.add(group.id);
      const groupBlocks = material.blocks.filter((b) => group.blockIds.includes(b.id));
      content.push({
        type: "templateGroup",
        attrs: { groupId: group.id, templateId: group.templateId, label: group.label },
        content: groupBlocks.flatMap((b) => blockToNodes(b)),
      });
      continue;
    }
    content.push(...blockToNodes(block));
  }

  if (content.length === 0) content.push({ type: "paragraph" });
  return { type: "doc", content };
}

export function blockToNodes(block: MaterialBlock): JSONContent[] {
  switch (block.type) {
    case "rich_text": {
      const nodes = (generateJSON(block.html?.trim() || "<p></p>", ext()).content ?? []) as JSONContent[];
      if (nodes.length === 0) return [{ type: "paragraph", attrs: { blockId: block.id } }];
      return nodes.map((n, i) => ({
        ...n,
        attrs: { ...(n.attrs ?? {}), blockId: i === 0 ? block.id : newBlockId() },
      }));
    }
    case "callout": {
      const inner = (generateJSON(block.html?.trim() || "<p></p>", ext()).content ?? []) as JSONContent[];
      return [
        {
          type: "callout",
          attrs: { blockId: block.id, variant: block.variant },
          content: inner.length > 0 ? inner : [{ type: "paragraph" }],
        },
      ];
    }
    case "formula":
      return [{ type: "formulaBlock", attrs: { id: block.id, latex: block.latex } }];
    case "page_break":
      return [{ type: "pageBreak", attrs: { id: block.id } }];
    case "image":
      return [{ type: "imageBlock", attrs: { data: block } }];
    case "audio":
      return [{ type: "audioBlock", attrs: { data: block } }];
    case "video":
      return [{ type: "videoBlock", attrs: { data: block } }];
    case "embed":
      return [{ type: "embedBlock", attrs: { data: block } }];
    case "table":
      return [{ type: "tableBlock", attrs: { data: block } }];
    case "question": {
      const parsed = (generateJSON(block.prompt.html?.trim() || "<p></p>", ext()).content ??
        []) as JSONContent[];
      const firstPara = parsed.find((n) => n.type === "paragraph");
      return [
        {
          type: "questionBlock",
          attrs: {
            qid: block.id,
            interaction: block.interaction,
            points: block.points,
            hint: block.hint?.html ?? null,
          },
          content: [firstPara ?? { type: "paragraph" }],
        },
      ];
    }
  }
}

// ─── JSONContent → Material ─────────────────────────────────────────────

export function docToMaterial(doc: JSONContent, base: Material): Material {
  const blocks: MaterialBlock[] = [];
  const groups: MaterialBlockGroup[] = [];

  for (const node of doc.content ?? []) {
    if (node.type === "templateGroup") {
      const childBlocks: MaterialBlock[] = [];
      for (const child of node.content ?? []) {
        const b = nodeToBlock(child);
        if (b) childBlocks.push(b);
      }
      if (childBlocks.length === 0) continue;
      blocks.push(...childBlocks);
      groups.push({
        id: (node.attrs?.groupId as string) || newBlockId(),
        templateId: (node.attrs?.templateId as string) || "custom",
        label: (node.attrs?.label as string) || "Конструкция",
        blockIds: childBlocks.map((b) => b.id),
      });
      continue;
    }
    const b = nodeToBlock(node);
    if (b) blocks.push(b);
  }

  return { ...base, blocks, groups };
}

function nodeToBlock(node: JSONContent): MaterialBlock | null {
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "bulletList":
    case "orderedList":
    case "blockquote": {
      const html = stripEditorAttrs(nodeHtml(node));
      if (isEmptyHtml(html)) return null;
      return { type: "rich_text", id: (node.attrs?.blockId as string) || newBlockId(), html };
    }
    case "callout": {
      const html = stripEditorAttrs(childrenHtml(node)) || "<p></p>";
      return {
        type: "callout",
        id: (node.attrs?.blockId as string) || newBlockId(),
        variant: (node.attrs?.variant as "note" | "warning" | "example") || "note",
        html,
      };
    }
    case "formulaBlock":
      return {
        type: "formula",
        id: (node.attrs?.id as string) || newBlockId(),
        latex: (node.attrs?.latex as string) || "",
      };
    case "pageBreak":
      return { type: "page_break", id: (node.attrs?.id as string) || newBlockId() };
    case "imageBlock":
    case "audioBlock":
    case "videoBlock":
    case "embedBlock":
    case "tableBlock": {
      const data = node.attrs?.data as MaterialBlock | undefined;
      if (!data) return null;
      return { ...data, id: data.id || newBlockId() } as MaterialBlock;
    }
    case "questionBlock": {
      const interaction = node.attrs?.interaction as QuestionInteraction | undefined;
      if (!interaction) return null;
      const hint = node.attrs?.hint as string | null | undefined;
      return {
        type: "question",
        id: (node.attrs?.qid as string) || newBlockId(),
        prompt: { html: stripEditorAttrs(childrenHtml(node)) || "<p></p>" },
        points: typeof node.attrs?.points === "number" ? (node.attrs.points as number) : 1,
        hint: hint ? { html: hint } : undefined,
        interaction,
      };
    }
    default:
      return null;
  }
}

function nodeHtml(node: JSONContent): string {
  return generateHTML({ type: "doc", content: [node] }, ext());
}

function childrenHtml(node: JSONContent): string {
  return generateHTML({ type: "doc", content: node.content ?? [{ type: "paragraph" }] }, ext());
}
