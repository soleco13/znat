import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Страницы сайта: адрес на домене → HTML-файл в сборке. Caddy отдаёт их
 * напрямую из dist/ (корневой Caddyfile, `handle /pricing` и т.д.), поэтому
 * адреса здесь и там должны совпадать.
 */
const PAGES = [
  { path: "/", file: "index.html" },
  { path: "/pricing", file: "pricing/index.html" },
  { path: "/contacts", file: "contacts/index.html" },
];

const BASE = "/landing/";

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
          if (!/\.(js|css|html|json|svg|mjs|xml|txt)$/.test(name) || statSync(file).size < 1024) continue;
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
 * В dev страницы открываются по тем же адресам, что на сайте (`/pricing`, а не
 * `/landing/pricing/index.html`), — ссылки в шапке работают без подмены.
 */
function devPages(): Plugin {
  return {
    name: "dev-pages",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = (req.url ?? "").split("?")[0]!.replace(/\/$/, "") || "/";
        const page = PAGES.find((p) => p.path === url);
        if (page) req.url = BASE + page.file;
        next();
      });
    },
  };
}

/**
 * Адрес сайта — из окружения (`VITE_SITE_URL`, по умолчанию `.env.production`):
 * canonical и og:url в каждой странице, robots.txt и sitemap.xml в сборке.
 * Без адреса эти теги и файлы не появляются — неверный canonical хуже никакого.
 */
function seo(siteUrl: string | undefined): Plugin {
  const site = siteUrl?.replace(/\/$/, "");
  return {
    name: "seo",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (!site) return html;
        const rel = ctx.path.replace(/^\//, "");
        const page = PAGES.find((p) => p.file === rel);
        if (!page) return html;
        const url = site + (page.path === "/" ? "/" : page.path);
        return html.replace(
          "</head>",
          `    <link rel="canonical" href="${url}" />\n    <meta property="og:url" content="${url}" />\n    <meta property="og:image" content="${site}${BASE}og.png" />\n  </head>`,
        );
      },
    },
    generateBundle() {
      if (!site) return;
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`,
      });
      const urls = PAGES.map((p) => `  <url><loc>${site}${p.path === "/" ? "/" : p.path}</loc></url>`).join("\n");
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), devPages(), seo(env.VITE_SITE_URL), brotliAssets()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    // Лендинг живёт рядом с самим приложением (то же Caddy, тот же домен), у
    // приложения уже заняты `/assets/*` под свой бандл. Свой префикс — чтобы
    // ассеты лендинга не перекрывались с ассетами приложения.
    base: BASE,
    build: {
      outDir: "dist",
      sourcemap: false,
      rollupOptions: {
        input: Object.fromEntries(
          PAGES.map((p) => [p.file.replace(/\/?index\.html$/, "") || "home", fileURLToPath(new URL(`./${p.file}`, import.meta.url))]),
        ),
      },
    },
  };
});
