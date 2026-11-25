/**
 * Адреса сайта. Страницы лендинга и приложение живут на одном домене (Caddy
 * раздаёт `/`, `/pricing`, `/contacts` из сборки лендинга, остальное — в
 * приложение), поэтому ссылки относительные, без адреса хоста.
 */
export type PageId = "home" | "doska" | "pricing" | "contacts" | "guide";

export const PAGES: { id: PageId; href: string; label: string }[] = [
  { id: "home", href: "/", label: "Главная" },
  { id: "doska", href: "/doska", label: "Онлайн-доска" },
  { id: "pricing", href: "/pricing", label: "Тарифы" },
  { id: "contacts", href: "/contacts", label: "Контакты" },
];

/** Статьи: в подвале, не в шапке. */
export const ARTICLES: { id: PageId; href: string; label: string }[] = [
  { id: "guide", href: "/blog/kak-provodit-onlajn-uroki", label: "Как проводить онлайн-уроки" },
];

/** Страницы приложения (apps/web/src/App.tsx). */
export const APP = {
  login: "/login",
  /** Выбор: репетитор (личный кабинет) или организация. */
  register: "/register",
  terms: "/terms",
  privacy: "/privacy",
  consent: "/consent",
  requisites: "/requisites",
} as const;

/** Запрос демонстрации на странице контактов. */
export const DEMO_HREF = "/contacts#demo";

/**
 * Оплата тарифа в кабинете: BillingPage читает `period`; без входа
 * RequireAuth уводит на /login и после входа возвращает сюда.
 */
export const billingHref = (plan: string, yearly: boolean) => `/billing?plan=${plan}&period=${yearly ? "year" : "month"}`;
