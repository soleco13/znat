/**
 * Service worker (`public/sw.js`) держит приложение на устройстве, чтобы урок
 * открывался быстро на плохой связи. Браузеры регистрируют его только на
 * сайте с доверенным сертификатом: на тестовом сервере по IP с самоподписанным
 * сертификатом регистрация молча не пройдёт — приложение работает как раньше.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

/**
 * Просит service worker докачать файлы урока (доску, задания) на устройство.
 * Вызывать, когда связь хорошая: на плохой фоновая закачка мешала бы уроку.
 */
export function requestLessonPrecache(): void {
  const controller = navigator.serviceWorker?.controller;
  const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  if (!controller || !entry) return;
  controller.postMessage({ type: "precache-lesson", entry: new URL(entry.src).pathname });
}
