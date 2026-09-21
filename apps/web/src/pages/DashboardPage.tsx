import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BookOpenCheck,
  BusFront,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  Navigation,
  QrCode,
  Route as RouteIcon,
  Star,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { LiveTripMap } from '../components/LiveMap';
import { Card, EmptyState, InlineAlert, PageHeader, Pill, Skeleton } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { api, asItems, unwrap } from '../lib/api';
import { formatDateTime, formatMoney, formatTime, localDateInputValue } from '../lib/format';
import { useRemoteData } from '../hooks/useRemoteData';
import type { Booking, DashboardSummary, RoadAlert, Trip } from '../types';

interface DashboardData {
  summary: DashboardSummary;
  bookings: Booking[];
  alerts: RoadAlert[];
  trips: Trip[];
}

export function DashboardPage() {
  const { user } = useAuth();
  const loadDashboard = useCallback(async (signal: AbortSignal): Promise<DashboardData> => {
    const isDriver = user?.role === 'DRIVER' || user?.role === 'CONDUCTOR';
    const [summaryResult, bookingsResult, alertsResult, tripsResult] = await Promise.allSettled([
      api.get<DashboardSummary | { data: DashboardSummary }>('/dashboard/summary', signal),
      user?.role === 'STUDENT'
        ? api.get<unknown>('/bookings?upcoming=true&limit=2', signal)
        : Promise.resolve([]),
      api.get<unknown>('/road-alerts?active=true&limit=4', signal),
      isDriver
        ? api.get<unknown>('/driver/trips?date=' + localDateInputValue(), signal)
        : Promise.resolve([]),
    ]);
    return {
      summary: summaryResult.status === 'fulfilled' ? unwrap(summaryResult.value) : {},
      bookings: bookingsResult.status === 'fulfilled' ? asItems<Booking>(bookingsResult.value) : [],
      alerts: alertsResult.status === 'fulfilled' ? asItems<RoadAlert>(alertsResult.value) : [],
      trips: tripsResult.status === 'fulfilled' ? asItems<Trip>(tripsResult.value) : [],
    };
  }, [user?.role]);
  const { data, loading, error, reload } = useRemoteData(loadDashboard, [user?.role]);

  if (!user) return null;
  const firstName = user.name.split(' ')[0];

  return (
    <div className="page-stack dashboard-page">
      <PageHeader
        description={dashboardDescription(user.role)}
        eyebrow={new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}
        title={`Good ${dayPart()}, ${firstName}`}
      />
      {Boolean(error) && <InlineAlert tone="warning">Some dashboard data is temporarily unavailable. <button className="text-button" onClick={reload} type="button">Try again</button></InlineAlert>}
      {loading ? <DashboardSkeleton /> : (
        <>
          {user.role === 'STUDENT' && <StudentDashboard bookings={data?.bookings ?? []} summary={data?.summary ?? {}} />}
          {(user.role === 'DRIVER' || user.role === 'CONDUCTOR') && <DriverDashboard summary={data?.summary ?? {}} trips={data?.trips ?? []} />}
          {user.role === 'ADMIN' && <AdminDashboard summary={data?.summary ?? {}} />}
          <AlertsPanel alerts={data?.alerts ?? []} />
        </>
      )}
    </div>
  );
}

function StudentDashboard({ bookings, summary }: { bookings: Booking[]; summary: DashboardSummary }) {
  const upcoming = bookings[0];
  return (
    <>
      <div className="stat-grid stat-grid--3">
        <StatCard icon={BookOpenCheck} label="Upcoming rides" tone="teal" value={summary.upcomingBookings ?? bookings.length} />
        <StatCard icon={Bell} label="Unread alerts" tone="amber" value={summary.unreadNotifications ?? 0} />
        <StatCard icon={Star} label="Trips this term" tone="violet" value={summary.completedTrips ?? 0} />
      </div>
      {upcoming?.trip ? (
        <section className="dashboard-grid dashboard-grid--map">
          <Card className="next-ride">
            <div className="card-heading"><div><p className="eyebrow">Your next ride</p><h2>{upcoming.trip.route?.name ?? 'University shuttle'}</h2></div><Pill>{upcoming.trip.status}</Pill></div>
            <div className="next-ride__time"><CalendarClock aria-hidden="true" /><div><strong>{formatDateTime(upcoming.trip.departureTime)}</strong><span>Departure</span></div></div>
            <div className="journey-line">
              <span className="journey-line__dot" /><div><strong>{upcoming.boardingStop?.name ?? upcoming.trip.route?.origin}</strong><small>Boarding point</small></div>
              <span className="journey-line__track" />
              <span className="journey-line__dot journey-line__dot--end" /><div><strong>{upcoming.destinationStop?.name ?? upcoming.trip.route?.destination}</strong><small>Destination</small></div>
            </div>
            <div className="next-ride__meta"><span><BusFront aria-hidden="true" /> {upcoming.trip.bus?.registrationNumber ?? 'Bus pending'}</span><span>Seat <b>{upcoming.seatNumber}</b></span></div>
            <div className="card-actions">
              <Link className="button button--primary button--md" to={`/student/bookings/${upcoming.id}`}><QrCode aria-hidden="true" size={17} /> View boarding pass</Link>
              <Link className="button button--ghost button--md" to="/student/routes">Find another bus</Link>
            </div>
          </Card>
          <LiveTripMap trip={upcoming.trip} />
        </section>
      ) : (
        <Card><EmptyState action={<Link className="button button--primary button--md" to="/student/routes">Find a bus <ArrowRight aria-hidden="true" size={17} /></Link>} icon={<RouteIcon />} title="Where are you headed?" description="Browse today's routes and reserve a seat in a few taps." /></Card>
      )}
      <QuickActions role="STUDENT" />
    </>
  );
}

function DriverDashboard({ summary, trips }: { summary: DashboardSummary; trips: Trip[] }) {
  return (
    <>
      <div className="stat-grid stat-grid--3">
        <StatCard icon={RouteIcon} label="Assigned today" to="/driver/trips" tone="teal" value={summary.assignedTrips ?? 0} />
        <StatCard icon={UsersRound} label="Passengers today" tone="violet" value={summary.passengersToday ?? 0} />
        <StatCard icon={Clock3} label="Trips in progress" tone="amber" value={summary.activeTrips ?? 0} />
      </div>
      
      <section style={{ marginTop: '32px' }}>
        <div className="section-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div><p className="eyebrow">Today's schedule</p><h2>Upcoming assignments</h2></div>
          <Link className="button button--ghost" to="/driver/trips">View all</Link>
        </div>
        {trips.length > 0 ? (
          <div className="driver-trip-list">
            {trips.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').slice(0, 3).map((trip) => (
              <Card className="driver-trip-card" key={trip.id}>
                <div className="driver-trip-card__time"><strong>{formatTime(trip.departureTime)}</strong><span>{new Date(trip.departureTime).toLocaleDateString(undefined, { weekday: 'short' })}</span></div>
                <div className="driver-trip-card__main">
                  <div><h2>{trip.route?.name}</h2><p>{trip.route?.origin} → {trip.route?.destination}</p></div>
                  <div className="driver-trip-card__meta">
                    <span><BusFront aria-hidden="true" /> {trip.bus?.registrationNumber}</span>
                    <span><UsersRound aria-hidden="true" /> {(trip.totalSeats ?? 0) - trip.availableSeats} passengers</span>
                    <span><Clock3 aria-hidden="true" /> {formatDateTime(trip.estimatedArrivalTime)}</span>
                  </div>
                </div>
                <Pill>{trip.status}</Pill>
                <Link className="button button--primary button--md" to={`/driver/trips/${trip.id}`}>{trip.status === 'IN_PROGRESS' ? <Navigation aria-hidden="true" size={17} /> : null} Open controls <ArrowRight aria-hidden="true" size={16} /></Link>
              </Card>
            ))}
            {trips.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').length === 0 && (
              <Card><EmptyState description="You have completed all your assigned trips for today!" title="All caught up" /></Card>
            )}
          </div>
        ) : (
          <Card><EmptyState description="The transport office has not assigned any trips to you today." title="You’re clear for now" /></Card>
        )}
      </section>

      <QuickActions role="DRIVER" />
    </>
  );
}

function AdminDashboard({ summary }: { summary: DashboardSummary }) {
  return (
    <>
      <div className="stat-grid stat-grid--4">
        <StatCard icon={BusFront} label="Active buses" tone="teal" value={summary.activeBuses ?? 0} />
        <StatCard icon={Navigation} label="Live trips" tone="blue" value={summary.activeTrips ?? 0} />
        <StatCard icon={BookOpenCheck} label="Bookings today" tone="violet" value={summary.bookingsToday ?? 0} />
        <StatCard icon={CircleDollarSign} label="Revenue today" tone="amber" value={formatMoney(summary.revenueToday ?? 0)} />
      </div>
      <QuickActions role="ADMIN" />
    </>
  );
}

function QuickActions({ role }: { role: 'STUDENT' | 'DRIVER' | 'ADMIN' }) {
  const actions = role === 'STUDENT'
    ? [
        { to: '/student/routes', icon: RouteIcon, title: 'Book a Ride', copy: 'Find trips and reserve seats' },
        { to: '/student/bookings', icon: QrCode, title: 'My Passes', copy: 'Open your secure entry QR' },
        { to: '/student/subscriptions', icon: WalletCards, title: 'Payments', copy: 'Manage your subscriptions' },
      ]
    : role === 'DRIVER'
      ? [
          { to: '/driver/trips', icon: Navigation, title: 'My Trips', copy: 'Start, track or end a trip' },
          { to: '/driver/check-in', icon: QrCode, title: 'Scanner', copy: 'Validate boarding passes' },
          { to: '/driver/incidents', icon: AlertTriangle, title: 'Report Issue', copy: 'Log maintenance or delays' },
        ]
      : [
          { to: '/admin/overview', icon: Navigation, title: 'Workspace', copy: 'Manage the entire fleet' },
          { to: '/admin/users', icon: UsersRound, title: 'People', copy: 'Verify students and drivers' },
          { to: '/admin/trips', icon: BusFront, title: 'Dispatch', copy: 'Monitor live operations' },
        ];
  return (
    <section><div className="section-heading"><div><p className="eyebrow">Shortcuts</p><h2>Move quickly</h2></div></div><div className="quick-grid">{actions.map((action) => { const Icon = action.icon; return <Link className="quick-link" key={action.to} to={action.to}><span><Icon aria-hidden="true" /></span><div><strong>{action.title}</strong><small>{action.copy}</small></div><ArrowRight aria-hidden="true" size={18} /></Link>; })}</div></section>
  );
}

function AlertsPanel({ alerts }: { alerts: RoadAlert[] }) {
  if (!alerts.length) return null;
  return (
    <section><div className="section-heading"><div><p className="eyebrow">Network status</p><h2>Active road updates</h2></div></div><div className="alert-list">{alerts.map((alert) => <Card className="road-alert-card" key={alert.id}><span className={`alert-icon alert-icon--${alert.severity.toLowerCase()}`}><AlertTriangle aria-hidden="true" /></span><div><div className="road-alert-card__title"><h3>{alert.title}</h3><Pill tone={['HIGH', 'MAJOR', 'CRITICAL'].includes(alert.severity) ? 'danger' : 'warning'}>{alert.category}</Pill></div><p>{alert.description}</p><small>{alert.route?.name ?? 'Network-wide'} · active until {alert.activeUntil ? formatDateTime(alert.activeUntil) : 'further notice'}</small></div></Card>)}</div></section>
  );
}

function StatCard({ icon: Icon, label, value, tone, to }: { icon: typeof BusFront; label: string; value: string | number; tone: string; to?: string }) {
  const content = <Card className="stat-card"><span className={`stat-card__icon stat-card__icon--${tone}`}><Icon aria-hidden="true" /></span><div><span>{label}</span><strong>{value}</strong></div></Card>;
  return to ? <Link to={to} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>{content}</Link> : content;
}

function DashboardSkeleton() {
  return <><div className="stat-grid stat-grid--3"><Card><Skeleton lines={2} /></Card><Card><Skeleton lines={2} /></Card><Card><Skeleton lines={2} /></Card></div><Card><Skeleton lines={5} /></Card></>;
}

function dayPart() {
  const hour = new Date().getHours();
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

function dashboardDescription(role: string) {
  if (role === 'STUDENT') return 'Here’s what is happening with your campus travel.';
  if (role === 'ADMIN') return 'A live pulse of the university transport network.';
  return 'Your assignments, passenger load and road conditions at a glance.';
}
