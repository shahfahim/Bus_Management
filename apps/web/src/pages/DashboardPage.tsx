import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BookOpenCheck,
  BusFront,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  MapPin,
  Navigation,
  QrCode,
  Route as RouteIcon,
  Star,
  UsersRound,
} from 'lucide-react';
import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { LiveTripMap } from '../components/LiveMap';
import { Card, EmptyState, InlineAlert, PageHeader, Pill, Skeleton } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { api, asItems, unwrap } from '../lib/api';
import { formatDateTime, formatMoney, formatTime } from '../lib/format';
import { useRemoteData } from '../hooks/useRemoteData';
import type { Booking, DashboardSummary, RoadAlert } from '../types';

interface DashboardData {
  summary: DashboardSummary;
  bookings: Booking[];
  alerts: RoadAlert[];
}

export function DashboardPage() {
  const { user } = useAuth();
  const loadDashboard = useCallback(async (signal: AbortSignal): Promise<DashboardData> => {
    const [summaryResult, bookingsResult, alertsResult] = await Promise.allSettled([
      api.get<DashboardSummary | { data: DashboardSummary }>('/dashboard/summary', signal),
      user?.role === 'STUDENT' || user?.role === 'TEACHER'
        ? api.get<unknown>('/bookings?upcoming=true&limit=2', signal)
        : Promise.resolve([]),
      api.get<unknown>('/road-alerts?active=true&limit=4', signal),
    ]);
    return {
      summary: summaryResult.status === 'fulfilled' ? unwrap(summaryResult.value) : {},
      bookings: bookingsResult.status === 'fulfilled' ? asItems<Booking>(bookingsResult.value) : [],
      alerts: alertsResult.status === 'fulfilled' ? asItems<RoadAlert>(alertsResult.value) : [],
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
          {(user.role === 'STUDENT' || user.role === 'TEACHER') && <StudentDashboard bookings={data?.bookings ?? []} summary={data?.summary ?? {}} />}
          {(user.role === 'DRIVER' || user.role === 'CONDUCTOR') && <DriverDashboard summary={data?.summary ?? {}} />}
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

function DriverDashboard({ summary }: { summary: DashboardSummary }) {
  const trip = summary.nextTrip;
  return (
    <>
      <div className="stat-grid stat-grid--3">
        <StatCard icon={RouteIcon} label="Assigned today" tone="teal" value={summary.assignedTrips ?? 0} />
        <StatCard icon={UsersRound} label="Passengers today" tone="violet" value={summary.passengersToday ?? 0} />
        <StatCard icon={Clock3} label="Trips in progress" tone="amber" value={summary.activeTrips ?? 0} />
      </div>
      <Card className="driver-next-trip">
        <div className="card-heading"><div><p className="eyebrow">Next assignment</p><h2>{trip?.route?.name ?? 'No upcoming assignment'}</h2></div>{trip && <Pill>{trip.status}</Pill>}</div>
        {trip ? (
          <div className="driver-next-trip__body">
            <div className="driver-next-trip__route"><span>{trip.route?.origin}</span><i /><BusFront aria-hidden="true" /><i /><span>{trip.route?.destination}</span></div>
            <div className="detail-grid"><div><span>Departure</span><strong>{formatTime(trip.departureTime)}</strong></div><div><span>Bus</span><strong>{trip.bus?.registrationNumber}</strong></div><div><span>Passengers</span><strong>{(trip.totalSeats ?? 0) - trip.availableSeats}</strong></div></div>
            <Link className="button button--primary button--md" to={`/driver/trips/${trip.id}`}>Open trip controls <ArrowRight aria-hidden="true" size={17} /></Link>
          </div>
        ) : <EmptyState description="The transport office has not assigned another trip yet." title="You’re clear for now" />}
      </Card>
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
        { to: '/student/routes', icon: RouteIcon, title: 'Find a route', copy: 'Compare trips and seats' },
        { to: '/student/bookings', icon: QrCode, title: 'Boarding passes', copy: 'Open secure entry QR' },
        { to: '/lost-found', icon: MapPin, title: 'Lost & found', copy: 'Report or search an item' },
      ]
    : role === 'DRIVER'
      ? [
          { to: '/driver/trips', icon: Navigation, title: 'Trip controls', copy: 'Start, track or end a trip' },
          { to: '/driver/check-in', icon: QrCode, title: 'Scan passenger', copy: 'Validate a boarding QR' },
          { to: '/driver/incidents', icon: AlertTriangle, title: 'Report road issue', copy: 'Alert transport control' },
        ]
      : [
          { to: '/admin/trips', icon: Navigation, title: 'Dispatch trips', copy: 'Schedule and assign vehicles' },
          { to: '/admin/maintenance', icon: BusFront, title: 'Fleet status', copy: 'Manage maintenance impact' },
          { to: '/admin/road-alerts', icon: AlertTriangle, title: 'Road alerts', copy: 'Notify affected routes' },
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

function StatCard({ icon: Icon, label, value, tone }: { icon: typeof BusFront; label: string; value: string | number; tone: string }) {
  return <Card className="stat-card"><span className={`stat-card__icon stat-card__icon--${tone}`}><Icon aria-hidden="true" /></span><div><span>{label}</span><strong>{value}</strong></div></Card>;
}

function DashboardSkeleton() {
  return <><div className="stat-grid stat-grid--3"><Card><Skeleton lines={2} /></Card><Card><Skeleton lines={2} /></Card><Card><Skeleton lines={2} /></Card></div><Card><Skeleton lines={5} /></Card></>;
}

function dayPart() {
  const hour = new Date().getHours();
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

function dashboardDescription(role: string) {
  if (role === 'STUDENT' || role === 'TEACHER') return 'Here’s what is happening with your campus travel.';
  if (role === 'ADMIN') return 'A live pulse of the university transport network.';
  return 'Your assignments, passenger load and road conditions at a glance.';
}
