import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { PLANS } from "./src/lib/plans";
import { SUPPORT_EMAIL } from "./src/lib/contacts";
import { GUIDE_PUBLISHED } from "./src/pages/guide-meta";

/**
 * Страницы сайта: адрес на домене → HTML-файл в сборке. Caddy отдаёт их
 * напрямую из dist/ (корневой Caddyfile и Caddyfile.prod, `@landing_pages`,
 * `@landing_page`, `@app_pages`), поэтому новый адрес добавлять и туда.
 */
const PAGES = [
  { path: "/", file: "index.html" },
  { path: "/doska", file: "doska/index.html" },
  { path: "/pricing", file: "pricing/index.html" },
  { path: "/contacts", file: "contacts/index.html" },
  { path: "/blog/kak-provodit-onlajn-uroki", file: "blog/kak-provodit-onlajn-uroki/index.html" },
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
 * Разметка Schema.org (JSON-LD) — только то, что видно на самой странице:
 * на главной — сайт и организация, на «Тарифах» — сервис с открытыми ценами,
 * у статьи — Article
 * (из src/lib/plans.ts, скрытые тарифы не попадают). Ни рейтингов, ни отзывов,
 * ни адреса — их на сайте нет.
 */
function structuredData(site: string, path: string): object | null {
  const org = {
    "@type": "Organization",
    "@id": `${site}/#org`,
    name: "Матис",
    alternateName: ["Matís", "Matis"],
    url: `${site}/`,
    logo: `${site}${BASE}og.png`,
    email: SUPPORT_EMAIL,
  };
  if (path === "/") {
    return {
      "@context": "https://schema.org",
      "@graph": [
        org,
        { "@type": "WebSite", "@id": `${site}/#site`, url: `${site}/`, name: "Матис", inLanguage: "ru", publisher: { "@id": `${site}/#org` } },
      ],
    };
  }
  if (path === "/blog/kak-provodit-onlajn-uroki") {
    return {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "Как проводить онлайн-уроки: руководство для репетитора",
      inLanguage: "ru",
      datePublished: GUIDE_PUBLISHED,
      dateModified: GUIDE_PUBLISHED,
      mainEntityOfPage: `${site}${path}`,
      image: `${site}${BASE}og.png`,
      author: { "@type": "Organization", name: "Матис", url: `${site}/` },
      publisher: org,
    };
  }
  if (path === "/pricing") {
    return {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Матис",
      url: `${site}/`,
      applicationCategory: "EducationalApplication",
      operatingSystem: "Web",
      description: "Платформа для онлайн-уроков: видеосвязь, доска и слайды в одном окне. Ученик входит на урок по ссылке.",
      publisher: org,
      offers: PLANS.filter((p) => !p.hidden).map((p) => ({
        "@type": "Offer",
        name: p.name,
        price: p.monthly,
        priceCurrency: "RUB",
        url: `${site}/pricing`,
      })),
    };
  }
  return null;
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
        const ld = structuredData(site, page.path);
        const ldTag = ld ? `    <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>\n` : "";
        return html.replace(
          "</head>",
          `    <link rel="canonical" href="${url}" />\n    <meta property="og:url" content="${url}" />\n    <meta property="og:image" content="${site}${BASE}og.png" />\n    <meta name="twitter:card" content="summary" />\n${ldTag}  </head>`,
        );
      },
    },
    generateBundle() {
      if (!site) return;
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        // Приложение (кабинет, уроки по ссылке) закрыто от индекса метатегом
        // noindex в apps/web/index.html, а не здесь: запрет обхода спрятал бы
        // от робота сам noindex. Здесь — только API и метки рекламы (Clean-param
        // понимает Яндекс: адреса с utm не считаются отдельными страницами).
        source: `User-agent: *\nAllow: /\nDisallow: /api/\nClean-param: utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid&gclid&ysclid\n\nSitemap: ${site}/sitemap.xml\n`,
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

export default defineConfig(({ mode, isSsrBuild }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: isSsrBuild ? [react()] : [react(), devPages(), seo(env.VITE_SITE_URL), brotliAssets()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    // Лендинг живёт рядом с самим приложением (то же Caddy, тот же домен), у
    // приложения уже заняты `/assets/*` под свой бандл. Свой префикс — чтобы
    // ассеты лендинга не перекрывались с ассетами приложения.
    base: BASE,
    // Вторая сборка (`vite build --ssr`) — только модуль предрендера для
    // scripts/prerender.mjs, в свою папку и без страниц-входов.
    build: isSsrBuild
      ? { outDir: "dist-ssr", sourcemap: false, rollupOptions: { input: "src/entries/prerender.tsx" } }
      : {
      outDir: "dist",
      sourcemap: false,
      rollupOptions: {
        input: Object.fromEntries(
          PAGES.map((p) => [p.file.replace(/\/?index\.html$/, "") || "home", fileURLToPath(new URL(`./${p.file}`, import.meta.url))]),
        ),
      },
    },
    // Пакеты в SSR-сборку целиком: Node не грузит их CSS (шрифт Manrope).
    ssr: { noExternal: true },
  };
});
