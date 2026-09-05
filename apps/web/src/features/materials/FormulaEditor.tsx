import { useEffect, useRef } from "react";
// Импорт CSS — шрифты MathLive (те же файлы KaTeX) объявлены в нём через
// `@font-face` и грузятся Vite в бандл как обычные ассеты со своего домена;
// сам импорт ставит `--ML__static-fonts` на `:root`, и рантайм MathLive
// (см. `--ML__static-fonts` в mathlive.mjs) видит это и не пытается сам
// резолвить `fontsDirectory` (по умолчанию — относительный путь, который
// без этого CSS ушёл бы на CDN отдельным запросом — §10.10/§15 ТЗ,
// «ничего с чужих CDN»).
import "mathlive/fonts.css";
// Импорт самого класса — уже побочный эффект: регистрирует `<math-field>`
// кастомным элементом (customElements.define внутри модуля mathlive).
import { MathfieldElement } from "mathlive";

// Клавиатурные звуки по умолчанию тянутся с относительного пути "./sounds"
// (при бандлинге — наш домен, но файлы туда никто не копировал, звук набора
// формулы нигде в ТЗ не требуется) — без этой строки браузер тихо ловил бы
// 404 на каждое нажатие клавиши.
MathfieldElement.soundsDirectory = null;

/**
 * Ввод формулы (Э9.4, §7.2 ТЗ: MathLive) — заменяет текстовый `<input>` с
 * сырым LaTeX (Э9.2/9.3). `<math-field>` — веб-компонент (кастомный
 * элемент), не JSX-узел React, поэтому создаётся императивно
 * (`document.createElement`) в один раз при монтировании, а не через JSX —
 * не нужна отдельная декларация `JSX.IntrinsicElements` под один тег,
 * которая была бы хрупкой к тому, как очередная версия типов React
 * размещает пространство имён `JSX` (React 19 уже переносило его).
 *
 * KaTeX-рендер формулы для ЧТЕНИЯ (превью/плеер, не редактирование) — не
 * здесь, а в `MaterialPlayer.tsx` (`ContentBlockView`, `case "formula"`):
 * `<math-field>` уже показывает формулу типографически набранной по мере
 * ввода, отдельный read-only превью рядом с полем был бы дублем того же
 * самого.
 */
export function FormulaEditor({ latex, onChange }: { latex: string; onChange: (latex: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const field = document.createElement("math-field") as MathfieldElement;
    field.className =
      "block w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary";
    field.value = latex;
    const handleInput = () => onChangeRef.current(field.value);
    field.addEventListener("input", handleInput);
    container.appendChild(field);
    fieldRef.current = field;
    return () => {
      field.removeEventListener("input", handleInput);
      container.removeChild(field);
      fieldRef.current = null;
    };
    // Поле создаётся ОДИН раз (пустые deps) — пересоздавать DOM-узел на
    // каждый рендер сбрасывало бы курсор/выделение внутри формулы; смена
    // блока (другой id) синхронизируется отдельным эффектом ниже через `.value`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const field = fieldRef.current;
    if (field && field.value !== latex) field.value = latex;
  }, [latex]);

  return <div ref={containerRef} />;
}
