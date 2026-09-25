# Лендинг «Матис»

Продающий одностраничник платформы (SaaS по подписке). Отдельный проект,
**не входит в pnpm-workspace** монолита — своя `node_modules`.

## Стек

Vite 6 + React 19 + TypeScript + Tailwind 3 + shadcn-примитивы (button, badge), `lucide-react`, `tailwindcss-animate`. Шрифт Manrope —
`@fontsource-variable/manrope` (кириллица, в бандле, без CDN). Анимации — CSS +
IntersectionObserver, без тяжёлых зависимостей; `prefers-reduced-motion`
показывает финальное состояние сразу.

Концепция: **страница — это урок**. Шапка страницы — шапка урока, навигация
внизу — панель управления урока, отзывы — сообщения чата, вопросы — «поднятые
руки», три шага — переписка в чате. Оформление — «пометки учителя»: маркер,
красный карандаш, тетрадная клетка (`Ink.tsx`, `.notebook`).

**Интерфейс урока в макетах — копия приложения** (`src/lesson/*`): плитки
участников, шапка, футер, панель участников/чата, доска, задание, прогресс
класса перенесены из `apps/web/src/features/{room,canvas,materials}` дословно
(классы и разметка), без LiveKit и данных. Шрифт внутри `.lesson-ui` — системный,
как в приложении. **Меняете интерфейс урока — синхронизируйте `src/lesson/`.**
Не копируется: видеопоток (вместо него силуэты) и иконки Excalidraw (lucide).

Единственное отличие токенов от приложения — `--font` (Manrope) у заголовков.

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
  index.css               токены ДС + утилиты (.notebook, .mark, .strike, .ink, .word, .draw…)
  lesson/                 копия интерфейса урока: parts · scenes · RoomWindow (десктоп/телефон) · data
  components/             Ink (Mark/Pencil/Strike/Ring/Words) · Reveal · SectionHeading · Logo · ui/
  sections/               Nav (+Dock) · Hero · Problem · Features · LessonFlow (закреплённое окно) ·
                          TaskEngine · HowItWorks · Security · Pricing · Testimonials · FAQ · CTA · Footer
  hooks/                  useReveal · useMedia
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
