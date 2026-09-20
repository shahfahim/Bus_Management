import {
  Bell,
  BookOpenCheck,
  ChevronDown,
  CircleUserRound,
  Gauge,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  QrCode,
  Route as RouteIcon,
  Shield,
  UserCheck,
  Users,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
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
  subItems?: { label: string; to: string; icon: typeof LayoutDashboard }[];
}

const commonNavigation: NavItem[] = [
  { label: 'Overview', to: '/dashboard', icon: LayoutDashboard, end: true },
  { label: 'Notifications', to: '/notifications', icon: Bell },
  { label: 'Lost & found', to: '/lost-found', icon: LifeBuoy },
];

const roleNavigation: Record<Role, NavItem[]> = {
  STUDENT: [
    { label: 'Book a Ride', to: '/student/routes', icon: RouteIcon },
    { label: 'My Bookings', to: '/student/bookings', icon: BookOpenCheck },
    { label: 'Passes & Payments', to: '/student/subscriptions', icon: WalletCards },
  ],
  DRIVER: [
    { label: 'My Trips & Scanner', to: '/driver/trips', icon: QrCode },
    { label: 'Report Issue', to: '/driver/incidents', icon: LifeBuoy },
  ],
  CONDUCTOR: [
    { label: 'My Trips & Scanner', to: '/driver/trips', icon: QrCode },
    { label: 'Report Issue', to: '/driver/incidents', icon: LifeBuoy },
  ],
  ADMIN: [
    { label: 'Workspace', to: '/admin/overview', icon: Gauge },
    {
      label: 'Users',
      to: '/admin/users-group', // Dummy path, won't be navigated to
      icon: Users,
      subItems: [
        { label: 'Student Approvals', to: '/admin/users?status=pending_verification', icon: UserCheck },
        { label: 'Drivers', to: '/admin/users?role=driver', icon: UsersRound },
        { label: 'Administrators', to: '/admin/users?role=admin', icon: Shield },
        { label: 'All Users', to: '/admin/users', icon: Users },
      ]
    },
  ],
};

export function AppShell() {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const { notify } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopMini, setDesktopMini] = useState(false);
  const [usersExpanded, setUsersExpanded] = useState(false);
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
    <div className={cx('app-shell', desktopMini && 'app-shell--mini')}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className={cx('sidebar', mobileOpen && 'sidebar--open', desktopMini && 'sidebar--mini')}>
        <div className="sidebar__brand-row">
          <Brand />
          <button aria-label="Toggle navigation" className="icon-button sidebar__toggle-desktop" onClick={() => setDesktopMini(!desktopMini)} type="button">
            {desktopMini ? <PanelLeftOpen aria-hidden="true" size={20} /> : <PanelLeftClose aria-hidden="true" size={20} />}
          </button>
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
            if (item.subItems) {
              const isActive = item.subItems.some(sub => location.pathname + location.search === sub.to);
              return (
                <div key={item.label} className="nav-group">
                  <button 
                    className={cx('nav-link', 'nav-link--group', isActive && 'nav-link--active')} 
                    onClick={() => {
                      if (desktopMini) setDesktopMini(false);
                      setUsersExpanded(!usersExpanded);
                    }}
                    type="button"
                  >
                    <Icon aria-hidden="true" size={19} />
                    <span>{item.label}</span>
                    <ChevronDown className={cx('nav-chevron', usersExpanded && 'nav-chevron--open')} size={16} />
                  </button>
                  <div className={cx('nav-sub', usersExpanded && !desktopMini && 'nav-sub--open')}>
                    {item.subItems.map(sub => {
                      const SubIcon = sub.icon;
                      const isSubActive = location.pathname + location.search === sub.to;
                      return (
                        <NavLink
                          className={cx('nav-link nav-link--sub', isSubActive && 'nav-link--active')}
                          key={sub.to}
                          onClick={() => setMobileOpen(false)}
                          to={sub.to}
                        >
                          <SubIcon aria-hidden="true" size={17} />
                          <span>{sub.label}</span>
                        </NavLink>
                      )
                    })}
                  </div>
                </div>
              )
            }

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
          <div className="sidebar__help-text">
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
