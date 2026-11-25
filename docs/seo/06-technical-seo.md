# Техническое SEO: как устроено

## Классы страниц

| Класс | Адреса | Индекс | Механизм |
|---|---|---|---|
| Публичные индексируемые | `/`, `/pricing`, `/contacts` | да | в sitemap.xml, canonical на себя, HTML с текстом (предрендер) |
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
VITE_SITE_URL=https://matis-edu.ru npx vite build --outDir "$OUT" --emptyOutDir
npx vite build --ssr
node scripts/prerender.mjs "$OUT"
```

Проверить `"$OUT"/index.html` (есть H1 и текст), затем `rsync -a "$OUT"/ dist/` и `rsync -a --delete "$OUT"/ dist/`.

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
