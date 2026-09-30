/*
 * Service worker «Матиса»: приложение живёт на устройстве, чтобы урок
 * открывался быстро даже на плохой связи.
 *
 * - `/assets/*` (в имени хеш содержимого, файл никогда не меняется) —
 *   сначала из кэша устройства, иначе из сети с сохранением.
 * - Страница приложения (навигация) — из сети, но если сеть не ответила за
 *   `SHELL_TIMEOUT_MS`, отдаём последнюю сохранённую копию: дальше код
 *   приложения уже в кэше, по сети идут только данные урока.
 * - Файлы урока (`/sw-assets.json`, собирается при сборке) докачиваются
 *   заранее — только по сигналу страницы `precache-lesson`, который она шлёт,
 *   когда связь хорошая: на плохой связи фоновая закачка мешала бы уроку.
 *
 * API, файлы, WebSocket и лендинг сюда не попадают — только статика приложения.
 */

const ASSETS_CACHE = "matis-assets-v1";
const SHELL_CACHE = "matis-shell-v1";
const SHELL_KEY = "/__app-shell";
const SHELL_TIMEOUT_MS = 4000;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([ASSETS_CACHE, SHELL_CACHE]);
      for (const name of await caches.keys()) {
        if (!keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

function isAppNavigation(url) {
  if (url.pathname === "/" || url.pathname.startsWith("/landing/")) return false;
  return !/^\/(api|files|ws|collab|livekit|metrics)(\/|$)/.test(url.pathname);
}

async function assetFromCacheOrNetwork(request) {
  const cache = await caches.open(ASSETS_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function shellFromNetworkOrCache(request) {
  const cache = await caches.open(SHELL_CACHE);
  const network = fetch(request).then(async (response) => {
    if (response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
      await cache.put(SHELL_KEY, response.clone());
    }
    return response;
  });
  const cached = await cache.match(SHELL_KEY);
  if (!cached) return network;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), SHELL_TIMEOUT_MS));
  try {
    const first = await Promise.race([network, timeout]);
    return first || cached;
  } catch {
    return cached;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(assetFromCacheOrNetwork(request));
  } else if (request.mode === "navigate" && isAppNavigation(url)) {
    event.respondWith(shellFromNetworkOrCache(request));
  }
});

/** Докачивает файлы урока, которых ещё нет, и удаляет устаревшие (от прошлых сборок). */
async function precacheLesson(pageEntry) {
  const response = await fetch("/sw-assets.json", { cache: "no-store" });
  if (!response.ok) return;
  const { assets } = await response.json();
  // Страница открылась из старой копии (сеть не ответила) — это не текущая
  // сборка; чистка удалила бы её собственные файлы.
  if (!assets.includes(pageEntry)) return;
  const cache = await caches.open(ASSETS_CACHE);
  for (const path of assets) {
    if (await cache.match(path)) continue;
    try {
      await cache.add(path);
    } catch {
      // обрыв — докачаем в следующий раз
    }
  }
  // Из старых сборок удаляем то, что не нужно ни текущему уроку, ни
  // сохранённой копии страницы (она может открыться на медленной сети и
  // сослаться на свои файлы) — иначе кэш рос бы с каждым деплоем.
  const keep = new Set(assets);
  const shell = await (await caches.open(SHELL_CACHE)).match(SHELL_KEY);
  if (shell) {
    for (const match of (await shell.text()).matchAll(/\/assets\/[^"']+/g)) keep.add(match[0]);
  }
  for (const request of await cache.keys()) {
    if (!keep.has(new URL(request.url).pathname)) await cache.delete(request);
  }
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "precache-lesson") {
    event.waitUntil(precacheLesson(event.data.entry).catch(() => undefined));
  }
});
