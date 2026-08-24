import { Bell, BellRing, CheckCheck, ExternalLink, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, InlineAlert, PageHeader, Pill, SelectField, Skeleton, cx, useToast } from '../../components/ui';
import { useSocket } from '../../contexts/SocketContext';
import { api, asItems, errorMessage, unwrap, withQuery } from '../../lib/api';
import { relativeTime, titleCase } from '../../lib/format';
import type { AppNotification } from '../../types';

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted',
  );
  const [error, setError] = useState('');
  const { notify } = useToast();
  const { socket } = useSocket();

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setNotifications(
        asItems<AppNotification>(
          await api.get<unknown>(
            withQuery('/notifications', {
              read: filter === 'ALL' ? undefined : filter === 'READ',
              pageSize: 50,
            }),
          ),
        ),
      );
    }
    catch (reason) { setError(errorMessage(reason, 'Could not load notifications.')); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!socket) return undefined;
    const add = (message: AppNotification) => setNotifications((current) => [message, ...current.filter((item) => item.id !== message.id)]);
    socket.on('notification:new', add);
    return () => { socket.off('notification:new', add); };
  }, [socket]);

  const markRead = async (notification: AppNotification) => {
    if (notification.readAt) return;
    try {
      const updated = unwrap(await api.patch<AppNotification | { data: AppNotification }>(`/notifications/${notification.id}/read`, {}));
      setNotifications((current) => current.map((item) => item.id === notification.id ? updated : item));
    } catch (reason) { notify({ title: 'Could not update notification', description: errorMessage(reason), tone: 'error' }); }
  };
  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
      notify({ title: 'All caught up', tone: 'success' });
    } catch (reason) { notify({ title: 'Could not mark all as read', description: errorMessage(reason), tone: 'error' }); }
  };

  const enablePush = async () => {
    setPushLoading(true);
    try {
      if (
        typeof Notification === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window)
      ) {
        throw new Error('Push notifications are not supported in this browser.');
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not granted. You can change it in browser settings.');
      const registration = await navigator.serviceWorker.register('/sw.js');
      const config = unwrap(await api.get<{ vapidPublicKey: string } | { data: { vapidPublicKey: string } }>('/notifications/push-config'));
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(config.vapidPublicKey) });
      await api.post('/notifications/push-subscriptions', subscription.toJSON());
      setPushEnabled(true);
      notify({ title: 'Push alerts enabled', description: 'Critical trip and ETA updates can now reach this device.', tone: 'success' });
    } catch (reason) { notify({ title: 'Push alerts not enabled', description: errorMessage(reason), tone: 'error' }); }
    finally { setPushLoading(false); }
  };

  const unread = notifications.filter((item) => !item.readAt).length;
  return (
    <div className="page-stack narrow-page">
      <PageHeader actions={<>{unread > 0 && <Button icon={<CheckCheck aria-hidden="true" size={17} />} onClick={() => void markAllRead()} variant="secondary">Mark all read</Button>}<Button disabled={pushEnabled} icon={<Smartphone aria-hidden="true" size={17} />} loading={pushLoading} onClick={() => void enablePush()}>{pushEnabled ? 'Push enabled' : 'Enable push alerts'}</Button></>} description="ETA, booking, payment and network changes in one timeline." eyebrow="Live updates" title="Notifications" />
      {!pushEnabled && <InlineAlert tone="info"><strong>Don’t miss your bus.</strong> Enable browser push alerts for the server-calculated “15 minutes away” ETA notification.</InlineAlert>}
      <div className="filter-row"><SelectField label="Show" onChange={(event) => setFilter(event.target.value)} options={[{ value: 'ALL', label: 'All notifications' }, { value: 'UNREAD', label: 'Unread only' }, { value: 'READ', label: 'Read' }]} value={filter} /></div>
      {error && <InlineAlert>{error}</InlineAlert>}
      {loading ? <Card><Skeleton lines={8} /></Card> : notifications.length === 0 ? <Card><EmptyState description="Booking confirmations, ETAs and transport updates will appear here." icon={<Bell />} title="You’re all caught up" /></Card> : (
        <div className="notification-list">{notifications.map((message) => <article className={cx('notification-item', !message.readAt && 'notification-item--unread')} key={message.id} onClick={() => void markRead(message)}><span className="notification-item__icon"><BellRing aria-hidden="true" /></span><div><div className="notification-item__heading"><strong>{message.title}</strong>{message.type && <Pill tone="info">{titleCase(message.type)}</Pill>}</div><p>{message.message}</p><small>{relativeTime(message.createdAt)}</small></div>{message.actionUrl && <Link aria-label={`Open ${message.title}`} className="icon-button" onClick={(event) => event.stopPropagation()} to={message.actionUrl}><ExternalLink aria-hidden="true" size={17} /></Link>}</article>)}</div>
      )}
    </div>
  );
}

function decodeVapidKey(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = window.atob(base64);
  return Uint8Array.from([...binary].map((character) => character.charCodeAt(0)));
}
