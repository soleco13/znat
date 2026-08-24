import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./Board.css";

/**
 * Доска урока (Э3.4, §3.3 ТЗ). Пока БЕЗ коллаборации — это отдельная
 * задача Э3.5 (`y-excalidraw` + Yjs). Здесь только локальный, изолированный
 * инстанс Excalidraw: рисование работает в браузере, ничего никуда не
 * отправляется и не сохраняется между перезагрузками.
 */
export function Board() {
  return (
    <div className="canvas-board" style={{ height: "70vh" }}>
      <Excalidraw
        UIOptions={{
          tools: { image: false },
        }}
      />
    </div>
  );
}
