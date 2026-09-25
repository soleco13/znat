// Э3.4, §3.3 ТЗ: шрифты Excalidraw самохостом, не с чужого CDN.
// Папка node_modules/@excalidraw/excalidraw/dist/prod/fonts целиком
// (не её содержимое — сама папка "fonts") скопирована в
// apps/web/public/fonts/. Важно: относительные пути к шрифтам внутри
// самого пакета Excalidraw уже включают префикс "fonts/"
// (например "./fonts/Cascadia/CascadiaCode-Regular.woff2"), поэтому
// при EXCALIDRAW_ASSET_PATH="/" итоговый URL получается
// "/fonts/Cascadia/...". Если скопировать СОДЕРЖИМОЕ fonts/ прямо в
// public/ (без обёртки "fonts"), как можно неверно прочитать README
// пакета, получится 404 → Vite отдаёт index.html как SPA-фолбэк →
// OTS-парсер браузера ругается на "invalid sfntVersion" → тихий
// откат на CDN esm.sh. Проверено вживую: curl на реальный dev/preview
// сервер + Content-Type ответа (см. заметки Э3.4 в
// docs/CURRENT_STAGE.md).
//
// Отдельный файл, а не inline-скрипт в index.html: CSP приложения
// разрешает только скрипты с нашего домена.
window.EXCALIDRAW_ASSET_PATH = "/";
