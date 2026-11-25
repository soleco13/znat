/**
 * Предрендер страниц сайта в HTML при сборке (`scripts/prerender.mjs`).
 *
 * Поисковые роботы и превью в мессенджерах получают готовый текст страницы,
 * а не пустой `<div id="root">`. В браузере тот же React «оживляет» эту
 * разметку (`hydrateRoot` в mount.tsx) — содержимое одно и то же.
 */
import { StrictMode, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { HomePage } from "@/pages/HomePage";
import { PricingPage } from "@/pages/PricingPage";
import { ContactsPage } from "@/pages/ContactsPage";
import { DoskaPage } from "@/pages/DoskaPage";
import { GuidePage } from "@/pages/GuidePage";

const pages: Record<string, () => ReactNode> = {
  "index.html": () => <HomePage />,
  "pricing/index.html": () => <PricingPage />,
  "contacts/index.html": () => <ContactsPage />,
  "doska/index.html": () => <DoskaPage />,
  "blog/kak-provodit-onlajn-uroki/index.html": () => <GuidePage />,
};

export function render(file: string): string {
  const page = pages[file];
  if (!page) throw new Error(`Нет страницы для предрендера: ${file}`);
  return renderToString(<StrictMode>{page()}</StrictMode>);
}

export const files = Object.keys(pages);
