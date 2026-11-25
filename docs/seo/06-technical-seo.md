# Техническое SEO: как устроено

## Классы страниц

| Класс | Адреса | Индекс | Механизм |
|---|---|---|---|
| Публичные индексируемые | `/`, `/doska`, `/pricing`, `/contacts`, `/blog/kak-provodit-onlajn-uroki` | да | в sitemap.xml, canonical на себя, HTML с текстом (предрендер) |
| Публичные, не для поиска | `/login`, `/register`, `/terms`, `/privacy`, `/consent`, `/requisites`, `/forgot-password` | нет | `noindex` в `apps/web/index.html` |
| Приватные | кабинет (`/lessons`, `/billing`, …), уроки `/<код>` | нет | `noindex` + вход по токену; robots.txt их **не** запрещает, иначе робот не увидит `noindex` |
| Технические | `/api/*` | нет | `Disallow: /api/` в robots.txt |

robots.txt — не защита: приватные данные закрыты авторизацией.

## Предрендер страниц сайта

- `landing/src/entries/prerender.tsx` — `renderToString` тех же компонентов страниц.
- `landing/scripts/prerender.mjs` — после клиентской сборки вставляет разметку в `#root` каждой страницы и обновляет `.br`-копии.
- `landing/src/entries/mount.tsx` — если в `#root` уже есть разметка, `hydrateRoot`, иначе (dev) `createRoot`.
- Всё, что зависит от браузера (`window`, `matchMedia`, WebGL-знак), работает только в `useEffect`. `useMedia` на первом рендере возвращает значение по умолчанию — как в HTML сборки. Новый код страниц должен соблюдать то же правило, иначе разметка при «оживлении» разойдётся.
- Без новых зависимостей: `react-dom/server` входит в `react-dom`.

## Сборка и выкатка сайта

`landing/dist` раздаёт Caddy, поэтому собирать прямо туда нельзя — сайт обновится до проверки. Сборка во временную папку:

```bash
cd landing
OUT=$(mktemp -d)
npx tsc --noEmit
VITE_SITE_URL=https://matis-edu.ru VITE_UMAMI_WEBSITE_ID=23981f7b-f29a-4082-80ee-980c63373edf \
  npx vite build --outDir "$OUT" --emptyOutDir
npx vite build --ssr
node scripts/prerender.mjs "$OUT"
```

Проверить `"$OUT"/index.html` (есть H1 и текст), затем `rsync -a "$OUT"/ dist/` и `rsync -a --delete "$OUT"/ dist/`.

Без `VITE_UMAMI_WEBSITE_ID` сайт соберётся без счётчика посещений (Umami, панель — stats.matis-edu.ru; ID сайта не секрет, он виден в HTML).

Важно: старая команда выкатки (`npx vite build` без шагов `--ssr` и `prerender.mjs`) соберёт сайт **без** текста в HTML.

## Метатеги и разметка (из `landing/vite.config.ts`, плагин `seo`)

На каждой странице: `canonical`, `og:url`, `og:image`, `twitter:card`. JSON-LD:
- главная — `Organization` (название, альтернативные написания, адрес сайта, логотип, почта поддержки) и `WebSite`;
- «Тарифы» — `SoftwareApplication` с `offers` из `src/lib/plans.ts` (скрытые тарифы не попадают).

Рейтингов, отзывов, адреса в разметке нет — их нет и на сайте.

## robots.txt (собирается из `vite.config.ts`)

```
User-agent: *
Allow: /
Disallow: /api/
Clean-param: utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid&gclid&ysclid

Sitemap: https://matis-edu.ru/sitemap.xml
```

## Адреса и редиректы (Caddyfile, проверено 25.11)

`http → https` 308, `www → без www` 301, `/pricing/ → /pricing` и `/contacts/ → /contacts` 301. Цепочек и циклов нет.

## Как добавить страницу сайта

1. `landing/<путь>/index.html` (title, description, og), `src/entries/<имя>.tsx`, страница в `src/pages/`.
2. `PAGES` в `landing/vite.config.ts` (sitemap и canonical берутся оттуда) и `src/entries/prerender.tsx`.
3. Шапка — `PAGES` в `src/lib/site.ts`, статья — `ARTICLES` (подвал).
4. Caddyfile и Caddyfile.prod: `@app_pages`, `@landing_page`, `@landing_pages`, `redir …/ …`. Выкатка — `caddy validate`, затем `caddy reload` только без живых уроков.
