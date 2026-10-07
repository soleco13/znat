import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Brotli-копии рядом с файлами сборки (`*.br`) — Caddy отдаёт их браузерам с
 * brotli (`file_server { precompressed br }`, корневой Caddyfile): сам Caddy
 * сжимает на лету только gzip/zstd. Тот же приём, что у приложения
 * (`apps/web/vite.config.ts`).
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
  plugins: [react(), brotliAssets()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Лендинг живёт на "/" рядом с самим приложением (то же Caddy, тот же IP,
  // без домена — см. корневой Caddyfile), у приложения уже заняты `/assets/*`
  // под свой собранный бандл. Свой префикс — чтобы ассеты лендинга не
  // перекрывались с ассетами приложения на одном хосте.
  base: "/landing/",
  build: { outDir: "dist", sourcemap: false },
});
