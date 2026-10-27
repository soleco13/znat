# Сайт «Матис»

Публичная часть: три страницы — главная `/`, тарифы `/pricing`, контакты
`/contacts`. Отдельный проект, **не входит в pnpm-workspace** монолита — своя
`node_modules`.

## Стек

Vite 6 (multi-page) + React 19 + TypeScript + Tailwind 3, `lucide-react`.
Шрифт Manrope — `@fontsource-variable/manrope` (кириллица, в бандле, без CDN):
им же набран логотип (`docs/brand/logo`). Анимации — CSS и
IntersectionObserver; 3D-знак — свой WebGL, без 3D-движка.

## Структура

```
index.html, pricing/index.html, contacts/index.html   страницы: title, description, og
src/
  entries/        точка входа каждой страницы (mount.tsx — общий корень)
  pages/          HomePage · PricingPage · ContactsPage
  site/Layout     шапка (Главная · Тарифы · Контакты, «Войти», «Начать») и подвал
  mark3d/         объёмный знак: renderer.ts (WebGL, SDF) · MarkScene.tsx (загрузка, пауза, запасной знак)
  lesson/         копия интерфейса урока из apps/web (демо на главной)
  lib/plans.ts    тарифы — копия packages/shared/src/billing.ts
  lib/site.ts     адреса страниц и приложения
  lib/contacts.ts контакты поддержки — копия packages/shared/src/support.ts
```

## Что синхронизировать с приложением

- **Тарифы** — `src/lib/plans.ts` повторяет `BILLING_PLANS` и `FREE_LIMITS`
  из `packages/shared/src/billing.ts` (лендинг общий пакет не подключает).
- **Контакты** — `src/lib/contacts.ts` ↔ `packages/shared/src/support.ts`.
- **Интерфейс урока** — `src/lesson/*` повторяет разметку
  `apps/web/src/features/{room,canvas,materials}`.
- **Знак** — геометрия в `src/mark3d/renderer.ts` и `src/components/BrandMark.tsx`
  та же, что у `apps/web/src/shared/ui/brand-mark.tsx`.

## 3D-знак

Фрагментный шейдер трассирует лучи по функции расстояния: диск с двумя
круглыми вырезами, выдавленный на толщину со скруглёнными кромками. Основное
движение — «перетекание» вырезов из фирменного лоадера (раз в ~9 с), второе —
наклон за курсором (только мышь). Кадр рисуется только во время движения; вне
экрана и в скрытой вкладке сцена стоит. Плотность пикселей ограничена (2, на
сенсорных экранах 1.5) и снижается сама, если кадры не успевают.
`prefers-reduced-motion` — один статичный кадр. Без WebGL или после потери
контекста — плоский SVG-знак. Рендерер — отдельный чанк, грузится после
отрисовки страницы; место под сцену зарезервировано.

## Разработка

```bash
cd landing
pnpm install --ignore-workspace   # обязательно --ignore-workspace
pnpm dev                          # http://localhost:5173/, /pricing, /contacts
pnpm build                        # tsc --noEmit + vite build → dist/
pnpm preview
```

Ссылки «Войти», «Начать», «Подключить» ведут в приложение на том же домене
(`/login`, `/register`, `/billing?plan=…`) — в dev без запущенного приложения
они не откроются.

## Деплой

`dist/` монтируется в Caddy (`./landing/dist:/srv/landing`, docker-compose.yml).
Caddy отдаёт `/`, `/pricing`, `/contacts`, `/robots.txt`, `/sitemap.xml` и
`/landing/*` из этой папки, остальное — приложению (Caddyfile, Caddyfile.prod).
Адрес сайта для canonical, og:url и sitemap — `VITE_SITE_URL`
(`.env.production`); без него эти теги и файлы не создаются.
