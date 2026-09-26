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
 * `sw-assets.json` — список файлов урока (куски из `LESSON_ENTRY_MODULES` со
 * всеми их статическими зависимостями и CSS) для service worker'а
 * (`public/sw.js`): он докачивает их на устройство, пока связь хорошая.
 */
function lessonAssetsManifest(): Plugin {
  return {
    name: "lesson-assets-manifest",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
      const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
      const assets = new Set<string>();
      const visit = (fileName: string) => {
        const chunk = byFile.get(fileName);
        if (!chunk || assets.has(`/${fileName}`)) return;
        assets.add(`/${fileName}`);
        for (const css of chunk.viteMetadata?.importedCss ?? []) assets.add(`/${css}`);
        for (const dep of chunk.imports) visit(dep);
      };
      for (const chunk of chunks) {
        if (chunk.isEntry || LESSON_ENTRY_MODULES.some((m) => chunk.facadeModuleId?.endsWith(m))) {
          visit(chunk.fileName);
        }
      }
      this.emitFile({
        type: "asset",
        fileName: "sw-assets.json",
        source: JSON.stringify({ assets: [...assets].sort() }),
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

export default defineConfig({
  plugins: [react(), lessonAssetsManifest(), brotliAssets()],
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
    sourcemap: true,
  },
});
