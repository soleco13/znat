/**
 * После `vite build` и `vite build --ssr`: вставляет готовую разметку каждой
 * страницы в <dist>/<страница>/index.html (вместо пустого <div id="root">) и
 * обновляет brotli-копии. SSR-сборку (dist-ssr/) после этого удаляет.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
const ssr = `${root}dist-ssr/prerender.js`;
// Папка клиентской сборки: по умолчанию dist/, иначе — первым аргументом
// (выкатка собирает во временную папку, см. docs/seo/06-technical-seo.md).
const dist = process.argv[2] ?? `${root}dist`;
const { render, files } = await import(pathToFileURL(ssr).href);

for (const file of files) {
  const path = `${dist}/${file}`;
  const html = readFileSync(path, "utf8");
  const marker = '<div id="root"></div>';
  if (!html.includes(marker)) throw new Error(`${file}: нет пустого #root`);
  const out = html.replace(marker, `<div id="root">${render(file)}</div>`);
  writeFileSync(path, out);
  writeFileSync(
    `${path}.br`,
    brotliCompressSync(out, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
  );
  console.log(`prerender: ${file} — ${Math.round(out.length / 1024)} КБ`);
}
rmSync(`${root}dist-ssr`, { recursive: true, force: true });
