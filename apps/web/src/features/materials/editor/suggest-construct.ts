import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { MATERIAL_CONSTRUCTS, type MaterialConstruct } from "../material-templates.js";
import { constructContent } from "./slash-menu.js";

/**
 * Контекстные подсказки конструкций (Э13): методист пишет текст — если в
 * текущем абзаце встречается слово-триггер конструкции («реши», «теорема»,
 * «диктант» …), в конце строки появляется ненавязчивая подсказка
 * «↳ Разбор задачи · Tab». Tab / клик — вставить конструкцию сразу после
 * абзаца. Esc — скрыть до изменения текста абзаца.
 */

const KEY = new PluginKey<SuggestState>("suggestConstruct");
const MIN_LEN = 6;
const SKIP_PARENTS = new Set(["callout", "questionBlock"]);

interface Match {
  construct: MaterialConstruct;
  /** позиция сразу ПОСЛЕ абзаца-источника — куда вставлять конструкцию */
  insertPos: number;
  /** конец абзаца изнутри — точка виджет-декорации */
  endInside: number;
}

interface SuggestState {
  match: Match | null;
  dismissedText: string | null;
}

const TRIGGERS = MATERIAL_CONSTRUCTS.flatMap((construct) =>
  construct.triggers.map((t) => {
    const multiWord = /[\s-]/.test(t);
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return {
      construct,
      re: multiWord ? new RegExp(esc, "i") : new RegExp(`(^|[^\\p{L}])${esc}[\\p{L}]*`, "iu"),
      weight: t.length,
    };
  }),
);

function findMatch(text: string): MaterialConstruct | null {
  let best: { c: MaterialConstruct; w: number } | null = null;
  for (const { construct, re, weight } of TRIGGERS) {
    if (re.test(text) && (!best || weight > best.w)) best = { c: construct, w: weight };
  }
  return best?.c ?? null;
}

function computeState(state: EditorState, dismissedText: string | null): SuggestState {
  const { selection } = state;
  if (!selection.empty) return { match: null, dismissedText };

  const $from = selection.$from;
  const block = $from.parent;
  if (block.type.name !== "paragraph" && block.type.name !== "heading") {
    return { match: null, dismissedText };
  }
  const parent = $from.node(-1);
  if (parent && SKIP_PARENTS.has(parent.type.name)) {
    return { match: null, dismissedText };
  }

  const text = block.textContent.trim();
  if (text.length < MIN_LEN || text === dismissedText) return { match: null, dismissedText };

  const construct = findMatch(text);
  if (!construct) return { match: null, dismissedText };

  return {
    match: { construct, insertPos: $from.after(), endInside: $from.end() },
    dismissedText,
  };
}

function insert(editor: Editor, match: Match): void {
  editor
    .chain()
    .focus()
    .insertContentAt(match.insertPos, constructContent(match.construct))
    .run();
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

export const SuggestConstruct = Extension.create({
  name: "suggestConstruct",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin<SuggestState>({
        key: KEY,
        state: {
          init: () => ({ match: null, dismissedText: null }),
          apply(tr, prev, _oldState, newState) {
            const meta = tr.getMeta(KEY) as { dismiss?: string } | undefined;
            const dismissedText = meta?.dismiss ?? prev.dismissedText;
            if (!tr.docChanged && !tr.selectionSet && !meta) {
              return { match: prev.match, dismissedText };
            }
            return computeState(newState, dismissedText);
          },
        },
        props: {
          decorations(state) {
            const s = KEY.getState(state);
            if (!s?.match) return null;
            const { construct, endInside } = s.match;
            return DecorationSet.create(state.doc, [
              Decoration.widget(
                endInside,
                () => {
                  const el = document.createElement("button");
                  el.type = "button";
                  el.className = "construct-hint";
                  el.setAttribute("contenteditable", "false");
                  el.innerHTML =
                    `<span class="construct-hint__label">↳ ${escapeHtml(construct.label)}</span>` +
                    `<span class="construct-hint__key">Tab</span>`;
                  el.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const cur = KEY.getState(editor.state);
                    if (cur?.match) insert(editor, cur.match);
                  });
                  return el;
                },
                { side: 1, ignoreSelection: true, key: `hint-${construct.id}` },
              ),
            ]);
          },
          handleKeyDown(view, event) {
            const s = KEY.getState(view.state);
            if (!s?.match) return false;
            if (event.key === "Tab") {
              event.preventDefault();
              insert(editor, s.match);
              return true;
            }
            if (event.key === "Escape") {
              const text = view.state.selection.$from.parent.textContent.trim();
              view.dispatch(view.state.tr.setMeta(KEY, { dismiss: text }));
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
