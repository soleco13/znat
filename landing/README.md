# Лендинг «Школа онлайн»

Продающий одностраничник платформы (SaaS по подписке). Отдельный проект,
**не входит в pnpm-workspace** монолита — своя `node_modules`.

## Стек

Vite 6 + React 19 + TypeScript + Tailwind 3 + shadcn-примитивы (button,
badge, accordion), `lucide-react`, `tailwindcss-animate`. Анимации — CSS +
IntersectionObserver, без тяжёлых зависимостей.

Дизайн-система — та же, что в `apps/web`: токены `src/index.css` перенесены
verbatim из `apps/web/src/index.css` (синий `#1d4ed8`, easing
`cubic-bezier(.2,.8,.2,1)`, радиусы, тени). При правках дизайн-системы в
приложении — синхронизировать сюда.

## Разработка

```bash
cd landing
pnpm install --ignore-workspace   # обязательно --ignore-workspace
pnpm dev                          # http://localhost:5173
pnpm build                        # tsc --noEmit + vite build → dist/
pnpm preview                      # предпросмотр prod-сборки
```

## Структура

```
src/
  App.tsx                 порядок секций
  index.css               токены ДС + утилиты лендинга (.reveal, .card-ring, aurora…)
  components/              переиспользуемые куски
    ui/                    button · badge · accordion (адаптированы под токены ДС)
    Reveal.tsx             появление при скролле
    ProductMock.tsx        макет «холста урока» для героя (живая вёрстка, не скрин)
    BrowserFrame.tsx       рамка браузера вокруг макета
    Aurora.tsx CountUp.tsx Marquee.tsx SectionHeading.tsx Logo.tsx ScrollProgress.tsx
  sections/               Nav · Hero · CapabilityBar · Stats · Problem · Features ·
                          CanvasShowcase · TaskEngine · HowItWorks · Security ·
                          Pricing · Testimonials · FAQ · CTA · Footer
  hooks/useReveal.ts
```

## Правки контента

- Тексты и тарифы — в соответствующих файлах `src/sections/*`.
- Цены: `src/sections/Pricing.tsx`, массив `PLANS` (₽/мес; переключатель
  «на год» = ×10/12).
- CTA-ссылки (`#pricing`, `#login`, `#cta`) — пока якоря; подставить реальные
  URL приложения при запуске.

## Деплой

Статика из `dist/` — на любой CDN / в Caddy рядом с приложением. SPA:
настроить фолбэк на `index.html`.
