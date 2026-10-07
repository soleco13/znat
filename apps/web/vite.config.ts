import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Куски, без которых урок не работает, — их service worker держит на устройстве. */
const LESSON_ENTRY_MODULES = [
  "src/features/room/RoomPage.tsx",
  "src/features/canvas/Board.tsx",
  "src/features/room/ActivityStage.tsx",
  "src/features/materials/LessonActivityPanel.tsx",
];

/**
 * Куски по требованию: список файлов для `warmChunk` (докачка с повторами
 * перед `import()`) есть, но service worker их заранее не качает. pdf.js —
 * только для PDF-презентаций (`canvas/pdf.ts` грузит его при первом PDF).
 */
const ON_DEMAND_MODULES = ["pdfjs-dist/build/pdf.mjs"];

/**
 * Динамические импорты внутри кусков урока, которые тоже нужны заранее:
 * Excalidraw подгружает сама русскую локаль и полифилл `roundRect`, без
 * повторов — оборвался запрос, и доска у ученика на английском.
 */
const LESSON_DYNAMIC_MODULES = [/\/ru-RU[-.]/, /roundRect/];

/**
 * `sw-assets.json` — список файлов урока (куски из `LESSON_ENTRY_MODULES` со
 * всеми их статическими зависимостями и CSS) для service worker'а
 * (`public/sw.js`): он докачивает их на устройство, пока связь хорошая.
 *
 * `chunks` — те же файлы по отдельности для каждого куска урока: страница
 * скачивает их с повторами до `import()` (`shared/chunk-warmup.ts`).
 */
function lessonAssetsManifest(): Plugin {
  return {
    name: "lesson-assets-manifest",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
      const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
      const visit = (fileName: string, into: Set<string>) => {
        const chunk = byFile.get(fileName);
        if (!chunk || into.has(`/${fileName}`)) return;
        into.add(`/${fileName}`);
        for (const css of chunk.viteMetadata?.importedCss ?? []) into.add(`/${css}`);
        for (const dep of chunk.imports) visit(dep, into);
      };
      const assets = new Set<string>();
      const perModule: Record<string, string[]> = {};
      for (const chunk of chunks) {
        // По составу, а не по `facadeModuleId`: Rollup может склеить кусок с
        // соседними модулями, и фасада у него не будет (так вышло с доской).
        const lessonModule = LESSON_ENTRY_MODULES.find((m) => chunk.moduleIds.some((id) => id.endsWith(m)));
        const module = lessonModule ?? ON_DEMAND_MODULES.find((m) => chunk.moduleIds.some((id) => id.endsWith(m)));
        if (chunk.isEntry || lessonModule) visit(chunk.fileName, assets);
        if (module) {
          const own = new Set<string>();
          visit(chunk.fileName, own);
          for (const dep of chunk.dynamicImports) {
            const ids = byFile.get(dep)?.moduleIds ?? [];
            if (ids.some((id) => LESSON_DYNAMIC_MODULES.some((re) => re.test(id)))) {
              visit(dep, own);
              visit(dep, assets);
            }
          }
          perModule[module] = [...own].sort();
        }
      }
      this.emitFile({
        type: "asset",
        fileName: "sw-assets.json",
        source: JSON.stringify({ assets: [...assets].sort(), chunks: perModule }),
      });
    },
  };
}

/**
 * Brotli-копии рядом с файлами сборки (`*.br`) — сервер (`@fastify/static`,
 * `preCompressed`) отдаёт их браузерам, которые понимают brotli: на ~20%
 * легче gzip, который Caddy делает на лету. Сжимаем один раз при сборке,
 * на максимальном качестве.
 */
function brotliAssets(): Plugin {
  let outDir = "";
  return {
    name: "brotli-assets",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const file = join(dir, name);
          if (statSync(file).isDirectory()) {
            walk(file);
            continue;
          }
          if (!/\.(js|css|html|json|svg|mjs)$/.test(name) || statSync(file).size < 1024) continue;
          const compressed = brotliCompressSync(readFileSync(file), {
            params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
          });
          writeFileSync(`${file}.br`, compressed);
        }
      };
      walk(outDir);
    },
  };
}

/**
 * Excalidraw 0.18 к каждому шрифту дописывает запасной источник на esm.sh
 * (`ASSETS_FALLBACK_URL`). Шрифты у нас свои (`public/fonts`,
 * `EXCALIDRAW_ASSET_PATH`), CSP чужой адрес всё равно не пустит, но Chrome
 * проверяет CSP для каждого `src` при создании FontFace — ~230 нарушений CSP
 * в консоли на каждое открытие доски (E2E-тест 2026-10-04). Подменяем
 * запасной адрес на свой. Если после обновления Excalidraw замена не
 * найдётся — сборка падает, чтобы чужой CDN не вернулся молча.
 */
function excalidrawNoCdnFallback(): Plugin {
  const FALLBACK = /("ASSETS_FALLBACK_URL",\s*)`https:\/\/esm\.sh\/[\s\S]*?\/dist\/(?:prod|dev)\/`/;
  return {
    name: "excalidraw-no-cdn-fallback",
    apply: "build",
    transform(code, id) {
      if (!id.includes("@excalidraw/excalidraw/dist/") || !code.includes("esm.sh")) return null;
      // База `new URL()` должна быть абсолютной.
      const next = code.replace(FALLBACK, '$1(window.location.origin + "/")');
      if (next === code || next.includes("https://esm.sh/")) {
        this.error(`excalidraw-no-cdn-fallback: адрес esm.sh в ${id} не заменён — проверьте ASSETS_FALLBACK_URL`);
      }
      return { code: next, map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), lessonAssetsManifest(), brotliAssets(), excalidrawNoCdnFallback()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/files": { target: "http://localhost:3000", changeOrigin: true },
      "/ws": { target: "ws://localhost:3000", ws: true },
      "/collab": { target: "ws://localhost:3000", ws: true },
    },
  },
  build: {
    outDir: "dist",
    // Карты собираются (для разбора ошибок), но без ссылки в коде: браузер о
    // них не знает, а в образ они кладутся вне раздаваемой папки (Dockerfile).
    // В картах — весь исходник фронтенда с комментариями, наружу им нельзя.
    sourcemap: "hidden",
  },
});
