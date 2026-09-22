/* eslint-disable */
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { API_CACHE_NAME } from './lib/offline-cache';

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
  cacheName: API_CACHE_NAME,
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

// Web Push: show server notifications and open only same-origin targets on click.
// The webworker lib clashes with DOM in this tsconfig, so type just what these handlers use.
interface WorkerEvent extends Event { waitUntil(promise: Promise<unknown>): void }
interface PushMessageEvent extends WorkerEvent { data: { json(): unknown } | null }
interface NotificationClickEvent extends WorkerEvent { notification: Notification }
interface WindowClientLike { url: string; focus(): Promise<unknown> }
interface PushWorkerScope {
  addEventListener(type: 'push', listener: (event: PushMessageEvent) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: NotificationClickEvent) => void): void;
  registration: ServiceWorkerRegistration;
  location: Location;
  clients: {
    matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly WindowClientLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
}
const worker = self as unknown as PushWorkerScope;

worker.addEventListener('push', (event) => {
  const payload = (event.data ? event.data.json() : {}) as {
    title?: string; message?: string; body?: string; tag?: string; id?: string; actionUrl?: string;
  };
  event.waitUntil(
    worker.registration.showNotification(payload.title || 'UniRide update', {
      body: payload.message || payload.body || 'There is a new transport update.',
      tag: payload.tag || payload.id,
      data: { url: payload.actionUrl || '/notifications' },
      renotify: Boolean(payload.tag),
    } as NotificationOptions),
  );
});

worker.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requestedTarget = new URL((event.notification.data as { url?: string } | null)?.url || '/notifications', worker.location.origin);
  const target = requestedTarget.origin === worker.location.origin
    ? requestedTarget.href
    : new URL('/notifications', worker.location.origin).href;
  event.waitUntil(
    worker.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url === target);
      if (existing) return existing.focus();
      return worker.clients.openWindow(target);
    }),
  );
});
