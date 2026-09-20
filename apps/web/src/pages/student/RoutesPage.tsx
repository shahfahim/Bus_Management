import { AlertTriangle, ArrowRight, BusFront, ChevronDown, Clock3, Map as MapIcon, Search, UsersRound } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RouteMap } from '../../components/LiveMap';
import { Button, Card, EmptyState, InlineAlert, PageHeader, Pill, SelectField, Skeleton, cx } from '../../components/ui';
import { useSocket } from '../../contexts/SocketContext';
import { api, asItems, errorMessage, withQuery } from '../../lib/api';
import { formatMoney, formatTime, localDateInputValue } from '../../lib/format';
import type { RoadAlert, Stop, Trip } from '../../types';

export function RoutesPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [alerts, setAlerts] = useState<RoadAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [date, setDate] = useState(localDateInputValue());
  const [view, setView] = useState<'list' | 'map'>('list');
  const [expandedTrip, setExpandedTrip] = useState<string>();
  const { socket } = useSocket();

  const searchTrips = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [year, month, day] = date.split('-').map(Number);
      const start = new Date(year, month - 1, day, 0, 0, 0);
      const end = new Date(year, month - 1, day, 23, 59, 59, 999);
      const response = await api.get<unknown>(withQuery('/trips', { from: start.toISOString(), to: end.toISOString(), originStopId: origin, destinationStopId: destination, status: ['SCHEDULED', 'BOARDING', 'DELAYED'] }));
      setTrips(asItems<Trip>(response));
    } catch (reason) {
      setError(errorMessage(reason, 'Could not load scheduled trips.'));
    } finally {
      setLoading(false);
    }
  }, [date, destination, origin]);

  useEffect(() => {
    Promise.allSettled([api.get<unknown>('/stops?active=true&limit=200'), api.get<unknown>('/road-alerts?active=true&limit=100')]).then(([stopResult, alertResult]) => {
      if (stopResult.status === 'fulfilled') setStops(asItems<Stop>(stopResult.value));
      if (alertResult.status === 'fulfilled') setAlerts(asItems<RoadAlert>(alertResult.value));
    });
  }, []);
  useEffect(() => { void searchTrips(); }, [searchTrips]);

  useEffect(() => {
    if (!socket) return undefined;
    const updateSeats = (payload: { tripId: string; availableSeats: number }) => {
      setTrips((current) => current.map((trip) => trip.id === payload.tripId ? { ...trip, availableSeats: payload.availableSeats } : trip));
    };
    const updateTrip = (payload: Partial<Trip> & { id: string }) => {
      setTrips((current) => current.map((trip) => trip.id === payload.id ? { ...trip, ...payload } : trip));
    };
    socket.on('trip:seats', updateSeats);
    socket.on('trip:updated', updateTrip);
    return () => {
      socket.off('trip:seats', updateSeats);
      socket.off('trip:updated', updateTrip);
    };
  }, [socket]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void searchTrips();
  };
  const selectedTrip = trips.find((trip) => trip.id === expandedTrip) ?? trips[0];
  const relevantAlerts = useMemo(() => alerts.filter((alert) => !selectedTrip || alertAffectsRoute(alert, selectedTrip.routeId)), [alerts, selectedTrip]);

  return (
    <div className="page-stack">
      <PageHeader description="Compare scheduled buses, live availability and route conditions." eyebrow="Student travel" title="Find your bus" />
      <Card className="trip-search-card">
        <form className="trip-search" onSubmit={submitSearch}>
          <SelectField label="From" onChange={(event) => setOrigin(event.target.value)} options={[{ value: '', label: 'Any boarding stop' }, ...stops.map((stop) => ({ value: stop.id, label: stop.name }))]} value={origin} />
          <SelectField label="To" onChange={(event) => setDestination(event.target.value)} options={[{ value: '', label: 'Any destination' }, ...stops.filter((stop) => stop.id !== origin).map((stop) => ({ value: stop.id, label: stop.name }))]} value={destination} />
          <label className="field"><span className="field__label">Travel date</span><input min={localDateInputValue()} onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label>
          <Button icon={<Search aria-hidden="true" size={17} />} type="submit">Search trips</Button>
        </form>
      </Card>
      <div className="results-toolbar">
        <div><strong>{loading ? 'Searching…' : `${trips.length} ${trips.length === 1 ? 'trip' : 'trips'} found`}</strong><span>Availability updates live</span></div>
        <div aria-label="Result view" className="view-toggle"><button aria-pressed={view === 'list'} onClick={() => setView('list')} type="button"><BusFront aria-hidden="true" /> List</button><button aria-pressed={view === 'map'} onClick={() => setView('map')} type="button"><MapIcon aria-hidden="true" /> Map</button></div>
      </div>
      {error && <InlineAlert>{error} <button className="text-button" onClick={() => void searchTrips()} type="button">Retry</button></InlineAlert>}
      {loading ? <div className="trip-list"><Card><Skeleton lines={4} /></Card><Card><Skeleton lines={4} /></Card></div> : trips.length === 0 ? (
        <Card><EmptyState description="Try a nearby stop or another travel date. Schedules are updated by transport control." icon={<BusFront />} title="No scheduled buses match" /></Card>
      ) : view === 'map' ? (
        <section className="routes-map-layout">
          <div className="routes-map-list">{trips.map((trip) => <button className={cx('map-trip-option', selectedTrip?.id === trip.id && 'map-trip-option--active')} key={trip.id} onClick={() => setExpandedTrip(trip.id)} type="button"><span><strong>{trip.route?.name}</strong><small>{formatTime(trip.departureTime)} · {trip.availableSeats} seats</small></span><Pill>{trip.status}</Pill></button>)}</div>
          <RouteMap alerts={relevantAlerts} busLocation={selectedTrip?.currentLocation ?? selectedTrip?.bus?.currentLocation} route={selectedTrip?.route} />
        </section>
      ) : (
        <div className="trip-list">{trips.map((trip) => <TripResult alerts={alerts.filter((alert) => alertAffectsRoute(alert, trip.routeId))} expanded={expandedTrip === trip.id} key={trip.id} onExpand={() => setExpandedTrip((current) => current === trip.id ? undefined : trip.id)} trip={trip} />)}</div>
      )}
    </div>
  );
}

function alertAffectsRoute(alert: RoadAlert, routeId: string) {
  return alert.routeId === routeId || alert.affectedRoutes?.some((route) => route.id === routeId) === true;
}

function TripResult({ trip, alerts, expanded, onExpand }: { trip: Trip; alerts: RoadAlert[]; expanded: boolean; onExpand: () => void }) {
  const soldOut = trip.availableSeats <= 0;
  const underMaintenance = trip.bus?.status === 'MAINTENANCE';
  const unavailable = soldOut || underMaintenance || trip.status === 'CANCELLED';
  return (
    <Card className="trip-result">
      <div className="trip-result__main">
        <div className="trip-time"><strong>{formatTime(trip.departureTime)}</strong><span>Departure</span></div>
        <div className="trip-route-summary">
          <div><span className="route-point" /><strong>{trip.route?.origin}</strong></div>
          <div className="route-track"><span /><BusFront aria-hidden="true" /><span /></div>
          <div><span className="route-point route-point--end" /><strong>{trip.route?.destination}</strong></div>
          <small><Clock3 aria-hidden="true" /> Approx. {trip.route?.durationMinutes ?? '—'} min · {trip.route?.stops?.length ?? 0} stops</small>
        </div>
        <div className="trip-bus"><strong>{trip.bus?.label ?? trip.bus?.registrationNumber}</strong><span>{trip.bus?.registrationNumber}</span>{underMaintenance && <Pill>MAINTENANCE</Pill>}</div>
        <div className={cx('seat-count', trip.availableSeats < 6 && 'seat-count--low')}><UsersRound aria-hidden="true" /><strong>{trip.availableSeats}</strong><span>seats left</span></div>
        <div className="trip-price"><strong>{formatMoney(trip.fare, trip.currency)}</strong><span>per ride</span></div>
        <div className="trip-result__actions"><Link aria-disabled={unavailable} className={cx('button button--primary button--md', unavailable && 'button--disabled')} onClick={(event) => unavailable && event.preventDefault()} to={`/student/trips/${trip.id}/book`}>{soldOut ? 'Sold out' : underMaintenance ? 'Unavailable' : 'Choose seat'} {!unavailable && <ArrowRight aria-hidden="true" size={16} />}</Link><button aria-expanded={expanded} aria-label="Show trip details" className="icon-button" onClick={onExpand} type="button"><ChevronDown aria-hidden="true" className={expanded ? 'rotate-180' : ''} /></button></div>
      </div>
      {trip.status === 'DELAYED' && <InlineAlert tone="warning">This trip is delayed by approximately {trip.delayMinutes ?? 0} minutes.</InlineAlert>}
      {alerts.length > 0 && <div className="trip-alert"><AlertTriangle aria-hidden="true" /><span>{alerts[0].title}</span><small>{alerts[0].category.toLowerCase()}</small></div>}
      {expanded && (
        <div className="trip-result__details">
          <div><h3>{trip.route?.name}</h3><p>{trip.route?.code} · driven by {trip.driver?.name ?? 'Assigned driver'}</p></div>
          <ol className="stop-sequence">{trip.route?.stops?.map((stop, index) => <li key={stop.id}><span>{index + 1}</span><div><strong>{stop.name}</strong><small>{stop.address}</small></div></li>)}</ol>
          {trip.bus?.amenities?.length ? <div className="amenity-list">{trip.bus.amenities.map((amenity) => <span key={amenity}>{amenity}</span>)}</div> : null}
        </div>
      )}
    </Card>
  );
}
