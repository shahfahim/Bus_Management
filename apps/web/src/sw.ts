import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

// --- PROXY PATTERN ---
// The Service Worker acts as a Proxy between the network and the application,
// intercepting fetch requests and fulfilling them via caching strategies.

// Precache static assets injected by Vite during build
precacheAndRoute(self.__WB_MANIFEST);

// --- STRATEGY PATTERN ---

// 1. CacheFirstStrategy
// Fetches static assets from cache to eliminate network latency.
const staticAssetsStrategy = new CacheFirst({
  cacheName: 'static-assets',
  plugins: [
    new CacheableResponsePlugin({ statuses: [0, 200] }),
    new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 }), // 30 Days
  ],
});
registerRoute(
  ({ request }) => request.destination === 'image' || request.destination === 'font',
  staticAssetsStrategy
);

// 2. StaleWhileRevalidateStrategy
// Returns cached lookups immediately, but updates cache in background so next request is fresh.
const lookupStrategy = new StaleWhileRevalidate({
  cacheName: 'lookup-cache',
});
registerRoute(
  ({ url }) => url.pathname.match(/^\/api\/(routes|buses|stops)/),
  lookupStrategy
);

// 3. NetworkFirstStrategy
// Tries to get the latest dynamic data from API, but falls back to cache if user goes offline.
const apiStrategy = new NetworkFirst({
  cacheName: 'api-cache',
  plugins: [
    new CacheableResponsePlugin({ statuses: [0, 200] }),
  ],
});
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/') && !url.pathname.match(/^\/api\/(routes|buses|stops)/),
  apiStrategy
);

// Lifecycle handlers
(self as any).addEventListener('install', () => {
  (self as any).skipWaiting();
});

(self as any).addEventListener('activate', () => {
  (self as any).clients.claim();
});
