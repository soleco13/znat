import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { assignSlides, type SlideUnit } from "@school/shared";

/**
 * Метки границ слайдов прямо в редакторе-«листе» (доп. Э13). Материал в
 * хранении плоский; на слайды его режет чистая `assignSlides` (`@school/shared`)
 * — та же, что у плеера ученика. Здесь единицы разбивки строятся из узлов
 * ProseMirror верхнего уровня, а плагин рисует виджет «Слайд N» перед каждым
 * узлом, с которого начинается новый слайд. Только визуальная подсказка
 * методисту: «сейчас ты на слайде N» — на сериализацию/сохранение не влияет.
 */
const slideMarkersKey = new PluginKey<DecorationSet>("slideMarkers");

function isHeading2(node: ProseMirrorNode | null | undefined): boolean {
  return !!node && node.type.name === "heading" && ((node.attrs.level as number) ?? 3) <= 2;
}

function unitForNode(node: ProseMirrorNode): SlideUnit {
  const name = node.type.name;
  if (name === "pageBreak") {
    return { isPageBreak: true, breakBefore: false, blockCount: 0, questionCount: 0 };
  }
  if (isHeading2(node)) {
    return { isPageBreak: false, breakBefore: true, blockCount: 1, questionCount: 0 };
  }
  if (name === "questionBlock") {
    return { isPageBreak: false, breakBefore: false, blockCount: 1, questionCount: 1 };
  }
  if (name === "templateGroup") {
    let blockCount = 0;
    let questionCount = 0;
    node.forEach((child) => {
      blockCount += 1;
      if (child.type.name === "questionBlock") questionCount += 1;
    });
    return {
      isPageBreak: false,
      breakBefore: isHeading2(node.firstChild),
      blockCount: Math.max(blockCount, 1),
      questionCount,
    };
  }
  return { isPageBreak: false, breakBefore: false, blockCount: 1, questionCount: 0 };
}

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const units: SlideUnit[] = [];
  const positions: number[] = [];
  doc.forEach((node, offset) => {
    units.push(unitForNode(node));
    positions.push(offset);
  });

  const slideOf = assignSlides(units);
  const decorations: Decoration[] = [];
  let prevSlide = -1;

  slideOf.forEach((slide, i) => {
    if (units[i]!.isPageBreak) return;
    if (slide === prevSlide) return;
    prevSlide = slide;
    decorations.push(
      Decoration.widget(
        positions[i]!,
        () => {
          const el = document.createElement("div");
          el.className = "slide-marker";
          el.contentEditable = "false";
          el.setAttribute("data-slide", String(slide + 1));
          el.textContent = `Слайд ${slide + 1}`;
          return el;
        },
        { side: -1, key: `slide-marker-${slide}` },
      ),
    );
  });

  return DecorationSet.create(doc, decorations);
}

export const SlideMarkers = Extension.create({
  name: "slideMarkers",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: slideMarkersKey,
        state: {
          init: (_config, { doc }) => buildDecorations(doc),
          apply: (tr, value) => (tr.docChanged ? buildDecorations(tr.doc) : value),
        },
        props: {
          decorations(state) {
            return slideMarkersKey.getState(state);
          },
        },
      }),
    ];
  },
});
