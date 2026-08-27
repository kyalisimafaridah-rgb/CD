// CareDesk offline app shell.
//
// Scope: static assets only (JS/CSS/HTML/icons) so the app loads at all
// with no signal. Deliberately does NOT intercept /api/trpc requests —
// those go through the app's own React Query cache (see
// client/src/lib/queryPersistence.ts) and offline outbox (see
// client/src/lib/syncEngine.ts), which know about idempotency keys and
// conflict handling. A service worker cache for API calls would silently
// serve stale data or replay writes without any of that logic, which is
// exactly the failure mode this whole setup exists to avoid.

const CACHE_NAME = "caredesk-shell-v20";
const APP_SHELL = ["/", "/index.html", "/favicon.png", "/logo.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {
      // Best-effort precache; a miss here just means first-load still needs network.
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never touch API calls — see note above.
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;

  // Navigation requests (loading/reloading a page) are the case that
  // matters most and the one the original version of this file got wrong:
  // this is a client-side-routed SPA, so a cold reload on e.g. /patients
  // or /appointments sends a real navigation request for that exact path.
  // That path was never fetched from the server as a real request (wouter
  // handles it client-side), so an exact-URL cache lookup always misses —
  // and offline, with no network to fall back to, that miss resolved to
  // `undefined`, which is a hard failure. The browser/OS then shows its
  // own native offline page instead of this app ever getting a chance to
  // load and route client-side.
  //
  // Fix: any navigation, network-first, falls back to the cached shell
  // (index.html) on failure — not to a cache match of that specific path.
  // Once index.html loads, wouter takes over and renders the right route
  // from the URL, same as it does on a normal online load.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", clone));
          }
          return response;
        })
        .catch(async () => {
          const shell = await caches.match("/index.html");
          return shell || Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached || Response.error());

      // Stale-while-revalidate for static assets: instant paint from
      // cache, refresh in the background when online. Falls through to
      // `network` (which itself falls back to `cached` on failure) only
      // when there's nothing cached yet.
      return cached || network;
    })
  );
});
