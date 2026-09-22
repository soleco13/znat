import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Лендинг живёт на "/" рядом с самим приложением (то же Caddy, тот же IP,
  // без домена — см. корневой Caddyfile), у приложения уже заняты `/assets/*`
  // под свой собранный бандл. Свой префикс — чтобы ассеты лендинга не
  // перекрывались с ассетами приложения на одном хосте.
  base: "/landing/",
  build: { outDir: "dist", sourcemap: false },
});
