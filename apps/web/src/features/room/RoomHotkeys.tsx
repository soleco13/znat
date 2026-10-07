import { useEffect } from "react";

/** Клавиша → `data-hotkey` кнопки панели урока. */
const KEYS: Record<string, string> = { KeyM: "M", KeyV: "V", KeyH: "H", KeyC: "C" };

/** Поля ввода и элементы, где буква — это текст или навигация, а не команда. */
const TEXT_ENTRY =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], math-field, [role="textbox"], [role="combobox"], [role="slider"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"]';

/**
 * Горячие клавиши урока на компьютере: M — микрофон, V — камера, H — рука,
 * C — чат. Нажимают ту же видимую кнопку панели (`data-hotkey`), что и мышь:
 * права и объяснения отказа («Микрофон выключил учитель») работают как при
 * клике. Не срабатывают:
 *  - при наборе текста (поля чата, ответов, формул) и в открытых меню;
 *  - с модификаторами (Ctrl/⌘/Alt — это браузерные сочетания) и при автоповторе;
 *  - пока на экране доска: у Excalidraw свои клавиши (V — выделение, H — рука).
 * «Рация» на пробеле сознательно не сделана: пробел прокручивает учебник и
 * нажимает кнопки в фокусе — конфликт с обычной работой ученика.
 */
export function RoomHotkeys() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const hotkey = KEYS[event.code];
      if (!hotkey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(TEXT_ENTRY)) return;
      if (document.querySelector(".excalidraw")) return;
      const button = [...document.querySelectorAll<HTMLElement>(`[data-hotkey="${hotkey}"]`)].find(
        (el) => el.getClientRects().length > 0,
      );
      if (!button) return;
      event.preventDefault();
      button.click();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return null;
}
