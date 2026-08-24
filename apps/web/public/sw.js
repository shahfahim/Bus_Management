self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  const title = payload.title || 'UniRide update';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.message || payload.body || 'There is a new transport update.',
      tag: payload.tag || payload.id,
      data: { url: payload.actionUrl || '/notifications' },
      renotify: Boolean(payload.tag),
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/notifications', self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url === target);
      if (existing) return existing.focus();
      return clients.openWindow(target);
    }),
  );
});
