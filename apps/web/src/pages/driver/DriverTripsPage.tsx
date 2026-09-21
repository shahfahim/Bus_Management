import { ArrowRight, BusFront, CalendarDays, Clock3, Navigation, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, InlineAlert, PageHeader, Pill, SelectField, Skeleton } from '../../components/ui';
import { useSocket } from '../../contexts/SocketContext';
import { api, asItems, errorMessage, withQuery } from '../../lib/api';
import { formatDateTime, formatTime, localDateInputValue } from '../../lib/format';
import type { Trip } from '../../types';

export function DriverTripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [date, setDate] = useState(localDateInputValue());
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { socket } = useSocket();
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setTrips(asItems<Trip>(await api.get<unknown>(withQuery('/driver/trips', { date, status, pageSize: 50 })))); }
    catch (reason) { setError(errorMessage(reason, 'Could not load assigned trips.')); }
    finally { setLoading(false); }
  }, [date, status]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!socket) return undefined;
    const update = (payload: Partial<Trip> & { id?: string; tripId?: string }) => {
      const updatedId = payload.id ?? payload.tripId;
      setTrips((current) => current.map((trip) => trip.id === updatedId ? { ...trip, ...payload } : trip));
    };
    socket.on('trip:updated', update);
    return () => { socket.off('trip:updated', update); };
  }, [socket]);

  return (
    <div className="page-stack">
      <PageHeader description="Review assignments, passenger load and real-time trip state." eyebrow="Driver operations" title="My Trips" />
      <Card className="driver-trip-filters"><label className="field"><span className="field__label">Service date</span><input onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label><SelectField label="Trip status" onChange={(event) => setStatus(event.target.value)} options={[{ value: '', label: 'All statuses' }, { value: 'SCHEDULED', label: 'Scheduled' }, { value: 'BOARDING', label: 'Boarding' }, { value: 'IN_PROGRESS', label: 'In progress' }, { value: 'DELAYED', label: 'Delayed' }, { value: 'COMPLETED', label: 'Completed' }]} value={status} /><Button onClick={() => void load()} variant="secondary">Refresh assignments</Button></Card>
      {error && <InlineAlert>{error}</InlineAlert>}
      {loading ? <div className="trip-list"><Card><Skeleton lines={4} /></Card><Card><Skeleton lines={4} /></Card></div> : trips.length === 0 ? <Card><EmptyState description="No bus or route has been assigned for this date and status." icon={<CalendarDays />} title="No assigned trips" /></Card> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {trips.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').length > 0 && (
            <div className="driver-trip-list">{trips.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').map((trip) => <Card className="driver-trip-card" key={trip.id}><div className="driver-trip-card__time"><strong>{formatTime(trip.departureTime)}</strong><span>{new Date(trip.departureTime).toLocaleDateString(undefined, { weekday: 'short' })}</span></div><div className="driver-trip-card__main"><div><h2>{trip.route?.name}</h2><p>{trip.route?.origin} → {trip.route?.destination}</p></div><div className="driver-trip-card__meta"><span><BusFront aria-hidden="true" /> {trip.bus?.registrationNumber}</span><span><UsersRound aria-hidden="true" /> {(trip.totalSeats ?? 0) - trip.availableSeats} passengers</span><span><Clock3 aria-hidden="true" /> {formatDateTime(trip.estimatedArrivalTime)}</span></div></div><Pill>{trip.status}</Pill><Link className="button button--primary button--md" to={`/driver/trips/${trip.id}`}>{trip.status === 'IN_PROGRESS' ? <Navigation aria-hidden="true" size={17} /> : null} Open controls <ArrowRight aria-hidden="true" size={16} /></Link></Card>)}</div>
          )}
          {trips.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').length === 0 && trips.some(t => t.status === 'COMPLETED' || t.status === 'CANCELLED') && (
            <Card><EmptyState description="There are no active trips remaining for this date." title="All caught up" /></Card>
          )}
          {trips.some(t => t.status === 'COMPLETED' || t.status === 'CANCELLED') && (
            <details className="past-trips-section" style={{ background: 'var(--surface)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <summary style={{ padding: '16px', fontWeight: 600, cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Past Trips ({trips.filter(t => t.status === 'COMPLETED' || t.status === 'CANCELLED').length})</span>
                <span aria-hidden="true" style={{ fontSize: '0.8em', color: 'var(--ink-soft)' }}>▼</span>
              </summary>
              <div style={{ padding: '16px', paddingTop: 0 }}>
                <div className="driver-trip-list">{trips.filter(t => t.status === 'COMPLETED' || t.status === 'CANCELLED').map((trip) => <Card className="driver-trip-card" key={trip.id} style={{ opacity: 0.8 }}><div className="driver-trip-card__time"><strong>{formatTime(trip.departureTime)}</strong><span>{new Date(trip.departureTime).toLocaleDateString(undefined, { weekday: 'short' })}</span></div><div className="driver-trip-card__main"><div><h2>{trip.route?.name}</h2><p>{trip.route?.origin} → {trip.route?.destination}</p></div><div className="driver-trip-card__meta"><span><BusFront aria-hidden="true" /> {trip.bus?.registrationNumber}</span><span><UsersRound aria-hidden="true" /> {(trip.totalSeats ?? 0) - trip.availableSeats} passengers</span><span><Clock3 aria-hidden="true" /> {formatDateTime(trip.estimatedArrivalTime)}</span></div></div><Pill tone={trip.status === 'CANCELLED' ? 'danger' : 'positive'}>{trip.status}</Pill><Link className="button button--secondary button--md" to={`/driver/trips/${trip.id}`}>View details <ArrowRight aria-hidden="true" size={16} /></Link></Card>)}</div>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
