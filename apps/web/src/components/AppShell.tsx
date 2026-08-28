import {
  Bell,
  BookOpenCheck,
  BusFront,
  ChevronDown,
  CircleUserRound,
  ClipboardCheck,
  Gauge,
  History,
  LayoutDashboard,
  LifeBuoy,
  Map,
  MapPinned,
  Menu,
  QrCode,
  Route as RouteIcon,
  ShieldCheck,
  Star,
  UsersRound,
  WalletCards,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { api, unwrap } from '../lib/api';
import { initials, titleCase } from '../lib/format';
import type { AppNotification, Role } from '../types';
import { Brand } from './Brand';
import { cx, useToast } from './ui';

interface NavItem {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

const commonNavigation: NavItem[] = [
  { label: 'Overview', to: '/dashboard', icon: LayoutDashboard, end: true },
  { label: 'Notifications', to: '/notifications', icon: Bell },
  { label: 'Lost & found', to: '/lost-found', icon: LifeBuoy },
];

const roleNavigation: Record<Role, NavItem[]> = {
  STUDENT: [
    { label: 'Find a bus', to: '/student/routes', icon: RouteIcon },
    { label: 'My bookings', to: '/student/bookings', icon: BookOpenCheck },
    { label: 'Payments', to: '/student/payments', icon: WalletCards },
    { label: 'Bus passes', to: '/student/subscriptions', icon: ShieldCheck },
    { label: 'Driver ratings', to: '/student/ratings', icon: Star },
  ],
  TEACHER: [
    { label: 'Find a bus', to: '/student/routes', icon: RouteIcon },
    { label: 'My bookings', to: '/student/bookings', icon: BookOpenCheck },
    { label: 'Payments', to: '/student/payments', icon: WalletCards },
    { label: 'Bus passes', to: '/student/subscriptions', icon: ShieldCheck },
    { label: 'Driver ratings', to: '/student/ratings', icon: Star },
  ],
  DRIVER: [
    { label: 'Assigned trips', to: '/driver/trips', icon: BusFront },
    { label: 'Set up a trip', to: '/driver/trips/new', icon: MapPinned },
    { label: 'Scan entry QR', to: '/driver/check-in', icon: QrCode },
    { label: 'Report an issue', to: '/driver/incidents', icon: ShieldCheck },
  ],
  CONDUCTOR: [
    { label: 'Assigned trips', to: '/driver/trips', icon: BusFront },
    { label: 'Scan entry QR', to: '/driver/check-in', icon: QrCode },
  ],
  ADMIN: [
    { label: 'Operations', to: '/admin/overview', icon: Gauge },
    { label: 'Buses', to: '/admin/buses', icon: BusFront },
    { label: 'Routes & stops', to: '/admin/routes', icon: MapPinned },
    { label: 'Trips', to: '/admin/trips', icon: Map },
    { label: 'People', to: '/admin/users', icon: UsersRound },
    { label: 'Bookings', to: '/admin/bookings', icon: BookOpenCheck },
    { label: 'Payments', to: '/admin/payments', icon: WalletCards },
    { label: 'Check-ins', to: '/admin/checkins', icon: ClipboardCheck },
    { label: 'Maintenance', to: '/admin/maintenance', icon: Wrench },
    { label: 'Reports', to: '/admin/reports', icon: History },
  ],
};

export function AppShell() {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .get<{ unread: number } | { data: { unread: number } }>('/notifications/unread-count')
      .then((payload) => setUnread(unwrap(payload).unread ?? 0))
      .catch(() => undefined);
  }, []);

  const { socket } = useSocket();
  useEffect(() => {
    if (!socket) return undefined;
    const onNotification = (message: AppNotification) => {
      setUnread((count) => count + 1);
      notify({ title: message.title, description: message.message, tone: 'info' });
    };
    const onRead = (payload?: { all?: boolean; updated?: number }) => {
      setUnread((count) => payload?.all ? 0 : Math.max(0, count - Math.max(1, payload?.updated ?? 1)));
    };
    socket.on('notification:new', onNotification);
    socket.on('notifications:read', onRead);
    return () => {
      socket.off('notification:new', onNotification);
      socket.off('notifications:read', onRead);
    };
  }, [notify, socket]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (!user) return null;
  const navigation = [...commonNavigation.slice(0, 1), ...roleNavigation[user.role], ...commonNavigation.slice(1)];

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className={cx('sidebar', mobileOpen && 'sidebar--open')}>
        <div className="sidebar__brand-row">
          <Brand />
          <button aria-label="Close navigation" className="icon-button sidebar__close" onClick={() => setMobileOpen(false)} type="button">
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="sidebar__role">
          <span>{titleCase(user.role)} portal</span>
          <span className={cx('connection-dot', connected && 'connection-dot--online')} />
          <small>{connected ? 'Live updates on' : 'Reconnecting…'}</small>
        </div>
        <nav aria-label="Primary navigation" className="sidebar__nav">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                className={({ isActive }) => cx('nav-link', isActive && 'nav-link--active')}
                end={item.end}
                key={item.to}
                onClick={() => setMobileOpen(false)}
                to={item.to}
              >
                <Icon aria-hidden="true" size={19} />
                <span>{item.label}</span>
                {item.to === '/notifications' && unread > 0 && <b className="nav-badge">{Math.min(unread, 99)}</b>}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar__help">
          <LifeBuoy aria-hidden="true" size={20} />
          <div>
            <strong>Need help?</strong>
            <a href="tel:+8809600000000">Transport control</a>
          </div>
        </div>
      </aside>
      {mobileOpen && <button aria-label="Close navigation" className="sidebar-scrim" onClick={() => setMobileOpen(false)} type="button" />}
      <div className="app-shell__body">
        <header className="topbar">
          <button aria-label="Open navigation" className="icon-button topbar__menu" onClick={() => setMobileOpen(true)} type="button">
            <Menu aria-hidden="true" />
          </button>
          <div className="topbar__campus">
            <span className="connection-dot connection-dot--online" />
            <span>University transport network</span>
          </div>
          <div className="topbar__actions">
            <NavLink aria-label={`${unread} unread notifications`} className="icon-button notification-button" to="/notifications">
              <Bell aria-hidden="true" size={20} />
              {unread > 0 && <span>{Math.min(unread, 9)}</span>}
            </NavLink>
            <div className="profile-menu" ref={profileRef}>
              <button aria-expanded={profileOpen} className="profile-trigger" onClick={() => setProfileOpen((open) => !open)} type="button">
                {user.avatarUrl ? <img alt="" src={user.avatarUrl} /> : <span className="avatar">{initials(user.name)}</span>}
                <span className="profile-trigger__copy">
                  <strong>{user.name}</strong>
                  <small>{user.email}</small>
                </span>
                <ChevronDown aria-hidden="true" size={16} />
              </button>
              {profileOpen && (
                <div className="profile-dropdown">
                  <NavLink onClick={() => setProfileOpen(false)} to="/profile">
                    <CircleUserRound aria-hidden="true" size={17} /> Profile & settings
                  </NavLink>
                  <button onClick={() => void handleLogout()} type="button">
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="main-content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
