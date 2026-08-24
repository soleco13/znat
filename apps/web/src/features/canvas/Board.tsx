import { useEffect, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { ExcalidrawBinding } from "y-excalidraw";
import * as Y from "yjs";
import { useAuthStore } from "../../shared/auth-store.js";
import "@excalidraw/excalidraw/index.css";
import "./Board.css";

/**
 * Доска урока (Э3.4/Э3.5, §3.4 ТЗ). Один `Y.Array "elements"` на весь холст
 * (без страниц — `Y.Map "pages"`/`activePageId` это Э3.6, здесь сознательно
 * не заводится, чтобы не смешивать задачи).
 *
 * Y.Doc/`HocuspocusProvider`/`ExcalidrawBinding` создаются и уничтожаются
 * ЦЕЛИКОМ ВНУТРИ ОДНОГО `useEffect`, а не через `useMemo` для Y.Doc — это
 * осознанное решение (область Y.Doc из списка «не делегировать вслепую»
 * CLAUDE.md): `useMemo` — подсказка для рендера, а не гарантия жизненного
 * цикла (React явно не обещает не выбрасывать мемоизированное значение), и
 * `useMemo`-колбэк не имеет парной функции очистки. Единый `useEffect`
 * даёт детерминированные create/destroy в паре и корректно переживает
 * двойной вызов эффектов в `StrictMode` (dev): при второй попытке монтирования
 * старые `provider`/`ydoc`/`binding` уже уничтожены первым cleanup, новые
 * создаются заново — утечки нет.
 */
export function Board({ lessonId }: { lessonId: string }) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!excalidrawAPI || !accessToken) return;

    const ydoc = new Y.Doc();
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const provider = new HocuspocusProvider({
      url: `${protocol}//${location.host}/collab`,
      name: lessonId,
      document: ydoc,
      token: accessToken,
    });

    const yElements = ydoc.getArray<Y.Map<unknown>>("elements");
    const yAssets = ydoc.getMap<unknown>("assets");
    const binding = new ExcalidrawBinding(yElements, yAssets, excalidrawAPI);

    return () => {
      binding.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [excalidrawAPI, lessonId, accessToken]);

  return (
    <div className="canvas-board" style={{ height: "70vh" }}>
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        UIOptions={{
          tools: { image: false },
        }}
      />
    </div>
  );
}
