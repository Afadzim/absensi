const CACHE_NAME = "absensi-pwa-v1";
const APP_SHELL = "/attendance";
const CACHEABLE_ASSET = /^\/_next\/static\//u;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const response = await fetch(APP_SHELL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Could not cache the attendance app shell (${response.status}).`);
      }
      await cache.put(APP_SHELL, response.clone());
      const html = await response.text();
      const assets = new Set(
        [...html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/gu)]
          .map((match) => match[1])
          .filter((asset) => typeof asset === "string"),
      );
      await Promise.all(
        [...assets].map(async (asset) => {
          const assetResponse = await fetch(asset, { cache: "no-store" });
          if (assetResponse.ok) await cache.put(asset, assetResponse);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("absensi-pwa-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate" && url.pathname === APP_SHELL) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(APP_SHELL, response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(APP_SHELL);
          return (
            cached ??
            new Response("Aplikasi presensi belum pernah dimuat saat online.", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            })
          );
        }),
    );
    return;
  }

  if (CACHEABLE_ASSET.test(url.pathname) || url.pathname === "/icon.svg") {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then(async (response) => {
            if (response.ok) {
              const cache = await caches.open(CACHE_NAME);
              await cache.put(request, response.clone());
            }
            return response;
          }),
      ),
    );
  }
});
