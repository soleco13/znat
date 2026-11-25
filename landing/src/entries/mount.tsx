import { StrictMode, type ReactNode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import "@/index.css";

export function mount(node: ReactNode) {
  const root = document.getElementById("root")!;
  const app = <StrictMode>{node}</StrictMode>;
  // Сборка кладёт в #root готовую разметку страницы (src/entries/prerender.tsx):
  // её «оживляем». В dev (`vite`) #root пустой — обычный рендер.
  if (root.firstElementChild) hydrateRoot(root, app);
  else createRoot(root).render(app);
}
