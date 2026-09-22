// The service worker keeps authenticated API responses here as an offline fallback.
export const API_CACHE_NAME = 'api-cache';

// Drop another account's cached bookings, payments and profile when the signed-in user changes.
export function clearPersonalApiCache() {
  if (typeof caches === 'undefined') return;
  void caches.delete(API_CACHE_NAME).catch(() => undefined);
}
