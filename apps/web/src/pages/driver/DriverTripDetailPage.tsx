import { AlertTriangle, ArrowLeft, CheckCircle2, Flag, LocateFixed, Navigation, Play, QrCode, Square, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RouteMap } from '../../components/LiveMap';
import { Button, Card, EmptyState, InlineAlert, Modal, PageHeader, Pill, Skeleton, useToast } from '../../components/ui';
import { useSocket } from '../../contexts/SocketContext';
import { useAuth } from '../../contexts/AuthContext';
import { useLocationSharing } from '../../hooks/useLocationSharing';
import { api, asItems, errorMessage, unwrap } from '../../lib/api';
import { formatDateTime, formatTime } from '../../lib/format';
import type { Passenger, Trip } from '../../types';

export function DriverTripDetailPage() {
  const { tripId = '' } = useParams();
  const [trip, setTrip] = useState<Trip>();
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmAction, setConfirmAction] = useState<'start' | 'end'>();
  const [actionLoading, setActionLoading] = useState(false);
  const { notify } = useToast();
  const { user } = useAuth();
  const { socket } = useSocket();
  const isDriver = user?.role === 'DRIVER';
  const sharing = useLocationSharing(tripId, isDriver && trip?.status === 'IN_PROGRESS');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [tripResponse, passengerResponse] = await Promise.all([
        api.get<Trip | { data: Trip }>(`/driver/trips/${tripId}`),
        api.get<unknown>(`/driver/trips/${tripId}/passengers?pageSize=200`),
      ]);
      setTrip(unwrap(tripResponse));
      setPassengers(asItems<Passenger>(passengerResponse));
    } catch (reason) { setError(errorMessage(reason, 'Could not load trip controls.')); }
    finally { setLoading(false); }
  }, [tripId]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!socket) return undefined;
    const joinTrip = () => socket.emit('trip:join', { tripId });
    joinTrip(); // join on mount
    const checkin = (payload: { tripId: string }) => {
      if (payload.tripId !== tripId) return;
      void api
        .get<unknown>(`/driver/trips/${tripId}/passengers?pageSize=200`)
        .then((response) => setPassengers(asItems<Passenger>(response)))
        .catch(() => undefined);
    };
    const update = (payload: Partial<Trip> & { id?: string; tripId?: string }) => {
      if ((payload.id ?? payload.tripId) !== tripId) return;
      setTrip((current) => (current ? { ...current, ...payload, id: current.id } : current));
    };
    socket.on('connect', joinTrip); // re-join after reconnect
    socket.on('checkin:created', checkin);
    socket.on('trip:updated', update);
    return () => { socket.emit('trip:leave', { tripId }); socket.off('connect', joinTrip); socket.off('checkin:created', checkin); socket.off('trip:updated', update); };
  }, [socket, tripId]);

  const performAction = async () => {
    if (!confirmAction) return;
    setActionLoading(true);
    try {
      const response = await api.post<Trip | { data: Trip }>(`/driver/trips/${tripId}/${confirmAction}`, {});
      const updated = unwrap(response); setTrip((current) => current ? { ...current, ...updated } : updated); setConfirmAction(undefined);
      notify({ title: confirmAction === 'start' ? 'Trip started' : 'Trip completed', description: confirmAction === 'start' ? 'Secure GPS sharing is now active.' : 'GPS sharing has stopped and trip records are finalised.', tone: 'success' });
    } catch (reason) { notify({ title: `Could not ${confirmAction} trip`, description: errorMessage(reason), tone: 'error' }); }
    finally { setActionLoading(false); }
  };

  const checkedIn = useMemo(() => passengers.filter((passenger) => passenger.checkedInAt).length, [passengers]);
  if (loading) return <div className="page-stack"><Skeleton lines={2} /><Card><Skeleton lines={10} /></Card></div>;
  if (!trip) return <div className="page-stack"><Link className="back-link" to="/driver/trips"><ArrowLeft /> Assigned trips</Link><InlineAlert>{error || 'Trip not found.'}</InlineAlert></div>;

  return (
    <div className="page-stack">
      <Link className="back-link" to="/driver/trips"><ArrowLeft aria-hidden="true" /> Assigned trips</Link>
      <PageHeader actions={<div className="trip-control-actions">{isDriver && ['SCHEDULED', 'BOARDING', 'DELAYED'].includes(trip.status) && <Button icon={<Play aria-hidden="true" size={17} />} onClick={() => setConfirmAction('start')}>Start trip</Button>}{isDriver && trip.status === 'IN_PROGRESS' && <Button icon={<Square aria-hidden="true" size={16} />} onClick={() => setConfirmAction('end')} variant="danger">End trip</Button>}<Link className="button button--secondary button--md" to={`/driver/check-in?tripId=${trip.id}`}><QrCode aria-hidden="true" size={17} /> Scan passengers</Link></div>} description={`${formatDateTime(trip.departureTime)} · ${trip.bus?.registrationNumber}`} eyebrow="Active assignment" title={trip.route?.name ?? 'Trip controls'} />
      {error && <InlineAlert>{error}</InlineAlert>}
      {trip.status === 'IN_PROGRESS' && <InlineAlert tone={sharing.error ? 'warning' : 'success'}>{sharing.error ? <><strong>GPS warning:</strong> {sharing.error}</> : <><strong>Location is sharing.</strong> Updates adapt to movement to preserve device battery.{sharing.lastSentAt && ` Last sent ${formatTime(sharing.lastSentAt)}.`}</>}</InlineAlert>}
      <div className="driver-control-grid">
        <Card className="trip-map-card"><div className="card-heading"><div><h2>Route & live position</h2><p>{trip.route?.origin} → {trip.route?.destination}</p></div><Pill>{trip.status}</Pill></div><RouteMap busLocation={sharing.latest ?? trip.currentLocation} route={trip.route} /><div className="driver-map-meta"><span><LocateFixed aria-hidden="true" /> {sharing.latest ? `Accuracy ±${Math.round(sharing.latest.accuracy)}m` : 'Waiting for GPS'}</span><span><Navigation aria-hidden="true" /> ETA {formatTime(trip.estimatedArrivalTime)}</span></div></Card>
        <Card className="passenger-manifest"><div className="card-heading"><div><h2>Passenger manifest</h2><p>{checkedIn} of {passengers.length} checked in</p></div><span className="manifest-count"><UsersRound aria-hidden="true" /> {passengers.length}</span></div><div className="manifest-progress"><span style={{ width: `${passengers.length ? (checkedIn / passengers.length) * 100 : 0}%` }} /></div>{passengers.length === 0 ? <EmptyState description="Confirmed passengers will appear here as bookings arrive." title="No passengers booked" /> : <div className="passenger-list">{passengers.map((passenger) => <div className="passenger-row" key={passenger.bookingId}><span className={passenger.checkedInAt ? 'check-avatar check-avatar--done' : 'check-avatar'}>{passenger.checkedInAt ? <CheckCircle2 aria-hidden="true" /> : passenger.seatNumber}</span><div><strong>{passenger.student.name}</strong><small>{passenger.student.studentId ?? passenger.reference}</small></div><span>Seat {passenger.seatNumber}</span>{passenger.checkedInAt ? <Pill tone="positive">Checked in</Pill> : <Pill>Waiting</Pill>}</div>)}</div>}</Card>
      </div>
      {isDriver && <Card className="trip-safety-bar"><AlertTriangle aria-hidden="true" /><div><strong>Hazard or emergency?</strong><span>Send the route, current GPS snapshot and severity to transport control.</span></div><Link className="button button--danger button--md" to={`/driver/incidents?tripId=${trip.id}`}><Flag aria-hidden="true" size={17} /> Report issue</Link></Card>}
      {isDriver && <Modal footer={<><Button onClick={() => setConfirmAction(undefined)} variant="ghost">Go back</Button><Button loading={actionLoading} onClick={() => void performAction()} variant={confirmAction === 'end' ? 'danger' : 'primary'}>{confirmAction === 'start' ? 'Start and share GPS' : 'End and finalise trip'}</Button></>} onClose={() => setConfirmAction(undefined)} open={Boolean(confirmAction)} title={confirmAction === 'start' ? 'Start this trip?' : 'End this trip?'}>{confirmAction === 'start' ? 'Passengers will see the live bus position. Keep location permission enabled until the trip ends.' : 'Only end the trip after the final stop. GPS sharing and further check-ins will stop.'}</Modal>}
    </div>
  );
}
