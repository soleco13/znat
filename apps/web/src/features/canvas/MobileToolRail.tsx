import { useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  ArrowRight,
  Circle,
  Diamond,
  Eraser,
  Hand,
  Lock,
  LockOpen,
  Minus,
  MousePointer2,
  Pencil,
  Shapes,
  Square,
  Type,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { SimpleTooltip } from "@/shared/ui/tooltip";

/** Подмножество `ToolType` пакета `@excalidraw/excalidraw` — ровно то, чем
 *  пользуется урок (без `image`/`frame`/`embeddable`/`laser`: та же
 *  причина, что у `UIOptions.tools={{ image: false }}` в Board.tsx). */
export type RailTool =
  | "selection"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "arrow"
  | "line"
  | "freedraw"
  | "text"
  | "eraser"
  | "hand";

const SHAPE_TOOLS: { tool: RailTool; icon: LucideIcon; label: string }[] = [
  { tool: "rectangle", icon: Square, label: "Прямоугольник" },
  { tool: "diamond", icon: Diamond, label: "Ромб" },
  { tool: "ellipse", icon: Circle, label: "Эллипс" },
  { tool: "arrow", icon: ArrowRight, label: "Стрелка" },
  { tool: "line", icon: Minus, label: "Линия" },
  { tool: "text", icon: Type, label: "Текст" },
];
const SHAPE_TOOL_SET = new Set(SHAPE_TOOLS.map((s) => s.tool));

const RAIL_BTN =
  "flex size-10 shrink-0 items-center justify-center rounded-lg text-text-2 transition-colors hover:bg-surface-2 [&_svg]:size-[19px]";
const RAIL_BTN_ACTIVE = "bg-primary-light text-primary hover:bg-primary-light";

/**
 * Компактная вертикальная панель инструментов доски для телефона/планшета
 * (жалоба пользователя, 2026-09-24): нативный тулбар Excalidraw на тач-
 * экранах показывал все 9+ инструментов в ряд (или колонкой — раньше по
 * ошибке, см. Board.css) сразу, без группировки, а «замочек»/«рука» вообще
 * висели отдельным блоком в углу — непонятно почему. Здесь вместо этого —
 * только 3 основных инструмента (выделение/карандаш/ластик) плюс рука и
 * замочек, ВСЕ в одном месте, а редкие фигуры (прямоугольник и т.д.) — под
 * одной кнопкой-каталогом, открывающейся выпадающим списком, а не занимают
 * место на панели постоянно.
 *
 * Сама панель заменяет нативный тулбар Excalidraw ПОЛНОСТЬЮ на тач-
 * экранах (тот скрыт через Board.css) — управляет холстом напрямую через
 * `excalidrawAPI.setActiveTool`, публичный императивный API пакета, а не
 * через клики по спрятанным родным кнопкам (хрупко и трудно стилизовать).
 */
export function MobileToolRail({
  excalidrawAPI,
  activeTool,
  locked,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  /** Текущий активный инструмент — Board.tsx следит за ним через `onChange` Excalidraw. */
  activeTool: RailTool;
  locked: boolean;
}) {
  // Иконка кнопки-каталога фигур — последняя выбранная из группы, как в
  // самом Excalidraw (сохранённый «дополнительный» инструмент), а не всегда
  // одна и та же: так кнопка отражает, чем реально пользовались последний раз.
  const [lastShapeTool, setLastShapeTool] = useState<RailTool>("rectangle");
  const shapeGroupActive = SHAPE_TOOL_SET.has(activeTool);
  const ShapeIcon = SHAPE_TOOLS.find((s) => s.tool === (shapeGroupActive ? activeTool : lastShapeTool))!.icon;

  function selectTool(tool: RailTool) {
    excalidrawAPI.setActiveTool({ type: tool, locked });
    if (SHAPE_TOOL_SET.has(tool)) setLastShapeTool(tool);
  }

  function toggleLock() {
    excalidrawAPI.setActiveTool({ type: activeTool, locked: !locked });
  }

  const ToolButton = ({ tool, icon: Icon, label }: { tool: RailTool; icon: LucideIcon; label: string }) => (
    <SimpleTooltip content={label} side="right">
      <button
        type="button"
        onClick={() => selectTool(tool)}
        aria-pressed={activeTool === tool}
        aria-label={label}
        className={cn(RAIL_BTN, activeTool === tool && RAIL_BTN_ACTIVE)}
      >
        <Icon aria-hidden />
      </button>
    </SimpleTooltip>
  );

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-0.5 rounded-xl border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
      <ToolButton tool="selection" icon={MousePointer2} label="Выделение" />
      <ToolButton tool="freedraw" icon={Pencil} label="Карандаш" />
      <ToolButton tool="eraser" icon={Eraser} label="Ластик" />

      <DropdownMenu>
        <SimpleTooltip content="Фигуры и текст" side="right">
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Фигуры и текст"
              className={cn(RAIL_BTN, shapeGroupActive && RAIL_BTN_ACTIVE)}
            >
              <ShapeIcon aria-hidden />
            </button>
          </DropdownMenuTrigger>
        </SimpleTooltip>
        {/* Пункты меню, не сетка иконок-с-тултипом: на тач-экране hover-
            подсказки всё равно не работают (нет hover-состояния), плюс
            вложенный `SimpleTooltip` (Radix Tooltip) внутри
            `DropdownMenuContent` перехватывал клик — пункт визуально
            закрывал меню, но `onClick` не долетал до `setActiveTool`
            (жалоба пользователя не про это прямо, но подряд ловилось
            вживую при проверке, 2026-09-24). Видимая подпись рядом с
            иконкой — тот же паттерн, что у пунктов меню «Ещё» (Board.tsx). */}
        <DropdownMenuContent side="right" align="start" className="w-48">
          {SHAPE_TOOLS.map(({ tool, icon: Icon, label }) => (
            <DropdownMenuItem key={tool} onSelect={() => selectTool(tool)}>
              <Icon aria-hidden />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="my-0.5 h-px w-6 shrink-0 bg-border" aria-hidden />

      <ToolButton tool="hand" icon={Hand} label="Рука (перемещение холста)" />
      <SimpleTooltip content={locked ? "Не закреплять инструмент" : "Закрепить инструмент после рисования"} side="right">
        <button
          type="button"
          onClick={toggleLock}
          aria-pressed={locked}
          aria-label="Закрепить инструмент"
          className={cn(RAIL_BTN, locked && RAIL_BTN_ACTIVE)}
        >
          {locked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
        </button>
      </SimpleTooltip>
    </div>
  );
}
