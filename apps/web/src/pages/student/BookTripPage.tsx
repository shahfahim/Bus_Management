/* eslint-disable */
import { ArrowLeft, BusFront, Clock3, CreditCard, MapPin, ShieldCheck } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RouteMap } from '../../components/LiveMap';
import { SeatMap } from '../../components/SeatMap';
import { Button, Card, InlineAlert, PageHeader, Pill, SelectField, Skeleton, useToast } from '../../components/ui';
import { useSocket } from '../../contexts/SocketContext';
import { api, asItems, errorMessage, unwrap } from '../../lib/api';
import { formatDateTime, formatMoney } from '../../lib/format';
import { bookingRepository } from '../../services/BookingRepository';
import type { Seat, StudentSubscription, Trip } from '../../types';

interface SeatHold {
  id: string;
  seatNumber: string;
  expiresAt: string;
}

interface SeatResponse {
  items: Seat[];
  currentHold?: SeatHold | null;
  updatedAt?: string;
}

export function BookTripPage() {
  const { tripId = '' } = useParams();
  const navigate = useNavigate();
  const { notify } = useToast();
  const { socket } = useSocket();
  const [trip, setTrip] = useState<Trip>();
  const [seats, setSeats] = useState<Seat[]>([]);
  const [subscriptions, setSubscriptions] = useState<StudentSubscription[]>([]);
  const [hold, setHold] = useState<SeatHold>();
  const [boardingStopId, setBoardingStopId] = useState('');
  const [destinationStopId, setDestinationStopId] = useState('');
  const [subscriptionId, setSubscriptionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [holding, setHolding] = useState(false);
  const [pendingSeatNumber, setPendingSeatNumber] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const bookingAttemptKey = useRef(crypto.randomUUID());
  const clockSkew = useRef(0);

  const load = useCallback(async (preserveError = false) => {
    setLoading(true);
    if (!preserveError) setError('');
    try {
      const [tripResponse, seatsResponse, subscriptionResponse] = await Promise.all([
        api.get<Trip | { data: Trip }>(`/trips/${tripId}`),
        api.get<SeatResponse | { data: SeatResponse }>(`/trips/${tripId}/seats`),
        api.get<unknown>('/subscriptions?status=ACTIVE'),
      ]);
      const nextTrip = unwrap(tripResponse);
      const seatState = unwrap(seatsResponse) as SeatResponse;
      if (seatState.updatedAt) {
        clockSkew.current = new Date(seatState.updatedAt).getTime() - Date.now();
      }
      setTrip(nextTrip);
      setSeats(asItems<Seat>(seatState));
      setHold(seatState.currentHold ?? undefined);
      setSubscriptions(asItems<StudentSubscription>(subscriptionResponse));
      if (nextTrip.route?.stops?.length) {
        setBoardingStopId((value) => value || nextTrip.boardingStopId || nextTrip.route!.stops[0].id);
        setDestinationStopId((value) => value || nextTrip.destinationStopId || nextTrip.route!.stops.at(-1)!.id);
      }
    } catch (reason) {
      setError(errorMessage(reason, 'Could not load this trip.'));
    } finally {
      setLoading(false);
    }
  }, [tripId]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!socket) return undefined;
    socket.emit('trip:join', { tripId });
    const seatUpdate = (payload: { tripId: string; seats?: Seat[]; seat?: Seat }) => {
      if (payload.tripId !== tripId) return;
      if (payload.seats) setSeats(payload.seats);
      else if (payload.seat) setSeats((current) => current.map((seat) => seat.number === payload.seat!.number ? { ...seat, ...payload.seat! } : seat));
      // A bare change notice (booking, cancellation, refund) carries no seat details; refetch them.
      else void api.get<SeatResponse | { data: SeatResponse }>(`/trips/${tripId}/seats`)
        .then((response) => setSeats(asItems<Seat>(unwrap(response))))
        .catch(() => undefined);
    };
    socket.on('trip:seats', seatUpdate);
    return () => {
      socket.emit('trip:leave', { tripId });
      socket.off('trip:seats', seatUpdate);
    };
  }, [socket, tripId]);

  // Leaving the page without booking frees the seat instead of blocking it until the hold expires.
  // A hold that became a booking is no longer HELD, so the server ignores the release.
  const holdRef = useRef<SeatHold | undefined>(undefined);
  holdRef.current = hold;
  useEffect(() => () => {
    const abandoned = holdRef.current;
    if (abandoned) void bookingRepository.releaseSeat(abandoned.id, tripId).catch(() => undefined);
  }, [tripId]);

  useEffect(() => {
    if (!hold) { setSecondsRemaining(0); return undefined; }
    const update = () => {
      if (!hold?.expiresAt) return;
      const realNow = Date.now() + clockSkew.current;
      const msRemaining = new Date(hold.expiresAt).getTime() - realNow;
      let remaining = Math.max(0, Math.ceil(msRemaining / 1000));
      setSecondsRemaining(remaining);
      if (remaining === 0) {
        setHold(undefined);
        void load(true);
      }
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [hold, load]);

  const selectSeat = async (seat: Seat) => {
    if (holding || hold?.seatNumber === seat.number) return;
    setHolding(true);
    setPendingSeatNumber(seat.number);
    setError('');
    try {
      const nextHold = await bookingRepository.holdSeat(tripId, seat.number) as SeatHold;
      bookingAttemptKey.current = crypto.randomUUID();
      setHold(nextHold);
      setSeats((current) => current.map((item) => ({ ...item, heldByCurrentUser: item.number === seat.number })));
      notify({ title: `Seat ${seat.number} held`, description: 'Complete the booking before the timer expires.', tone: 'success' });
    } catch (reason) {
      await load(true);
      setError(errorMessage(reason, 'That seat was just taken. Choose another seat.'));
    } finally {
      setHolding(false);
      setPendingSeatNumber(undefined);
    }
  };

  const submitBooking = async (event: FormEvent) => {
    event.preventDefault();
    if (!hold) { setError('Choose an available seat first.'); return; }
    if (boardingStopId === destinationStopId) { setError('Boarding and destination stops must be different.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const booking = await bookingRepository.finalize({
        tripId,
        seatNumber: hold.seatNumber,
        seatHoldId: hold.id,
        boardingStopId,
        destinationStopId,
        ...(subscriptionId ? { subscriptionId } : {}),
      }, bookingAttemptKey.current) as { status: string; reference: string; id: string };
      setHold(undefined);
      notify({
        title: 'Seat booked',
        description: booking.status === 'CONFIRMED'
          ? `Booking ${booking.reference} is confirmed with your bus pass.`
          : `Booking ${booking.reference} is awaiting payment.`,
        tone: 'success',
      });
      navigate(`/student/bookings/${booking.id}`, { replace: true });
    } catch (reason) {
      setError(errorMessage(reason, 'The booking could not be completed.'));
    } finally {
      setSubmitting(false);
    }
  };

  const orderedStops = trip?.route?.stops ?? [];
  const boardingIndex = orderedStops.findIndex((stop) => stop.id === boardingStopId);
  // Only show stops AFTER the boarding stop as valid destinations
  const destinationOptions = boardingIndex >= 0
    ? orderedStops.filter((_, index) => index > boardingIndex)
    : [];
  const selectedSeatNumber = pendingSeatNumber ?? hold?.seatNumber;
  const openSeats = seats.filter((seat) => seat.status === 'AVAILABLE').length;
  const eligibleSubscriptions = subscriptions.filter((subscription) => {
    if (!trip || subscription.status !== 'ACTIVE') return false;
    const routes = subscription.plan.routes.map((item) => ('route' in item ? item.route : item));
    return routes.some(({ id }) => id === trip.routeId);
  });
  const canSubmit = Boolean(hold && boardingStopId && destinationStopId && secondsRemaining > 0);
  const formattedTimer = `${String(Math.floor(secondsRemaining / 60)).padStart(2, '0')}:${String(secondsRemaining % 60).padStart(2, '0')}`;
  const routePath = useMemo(() => trip?.route, [trip]);

  if (loading) return <div className="page-stack"><Skeleton lines={2} /><div className="booking-layout"><Card><Skeleton lines={8} /></Card><Card><Skeleton lines={8} /></Card></div></div>;
  if (!trip) return <div className="page-stack"><Link className="back-link" to="/student/routes"><ArrowLeft /> Back to trips</Link><InlineAlert>{error || 'Trip not found.'}</InlineAlert></div>;

  return (
    <div className="page-stack">
      <Link className="back-link" to="/student/routes"><ArrowLeft aria-hidden="true" /> Back to trip results</Link>
      <PageHeader description={`${formatDateTime(trip.departureTime)} · ${trip.bus?.registrationNumber ?? 'Bus assignment pending'}`} eyebrow={trip.route?.code} title={`Choose a seat · ${trip.route?.name}`} />
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="booking-layout">
        <Card className="seat-card">
          <div className="card-heading"><div><h2>Seat selection</h2><p>Availability changes in real time.</p></div><Pill tone={openSeats < 6 ? 'warning' : 'positive'}>{`${openSeats} left`}</Pill></div>
          {holding && <div className="seat-loading"><span className="spin-small" /> Securing your seat…</div>}
          <SeatMap onSelect={(seat) => void selectSeat(seat)} seats={seats} selected={selectedSeatNumber} />
        </Card>
        <aside className="booking-summary-stack">
          <Card className="booking-summary">
            <div className="card-heading"><div><p className="eyebrow">Trip summary</p><h2>{trip.route?.origin} → {trip.route?.destination}</h2></div><BusFront aria-hidden="true" /></div>
            <RouteMap className="booking-mini-map" route={routePath} />
            <form onSubmit={submitBooking}>
              <SelectField label="Board at" onChange={(event) => { setBoardingStopId(event.target.value); setDestinationStopId(''); }} options={orderedStops.slice(0, -1).map((stop) => ({ value: stop.id, label: stop.name }))} value={boardingStopId} />
              <SelectField label="Get off at" onChange={(event) => setDestinationStopId(event.target.value)} options={[{ value: '', label: 'Choose destination', disabled: true }, ...destinationOptions.map((stop) => ({ value: stop.id, label: stop.name }))]} value={destinationStopId} />
              {eligibleSubscriptions.length > 0 && <SelectField label="Fare option" onChange={(event) => setSubscriptionId(event.target.value)} options={[{ value: '', label: 'Pay single-trip fare' }, ...eligibleSubscriptions.map((subscription) => ({ value: subscription.id, label: `${subscription.plan.name} · ${subscription.remainingTrips == null ? 'unlimited' : `${subscription.remainingTrips} left`}` }))]} value={subscriptionId} />}
              <div className="summary-lines">
                <div><span><MapPin aria-hidden="true" /> Seat</span><strong>{hold?.seatNumber ?? 'Choose one'}</strong></div>
                <div><span><CreditCard aria-hidden="true" /> Fare</span><strong>{subscriptionId ? 'Covered by pass' : formatMoney(trip.fare, trip.currency)}</strong></div>
              </div>
              {hold && <div className="hold-timer"><Clock3 aria-hidden="true" /><span>Seat held for</span><strong>{formattedTimer}</strong></div>}
              <Button className="booking-submit" disabled={!canSubmit} loading={submitting} size="lg" type="submit">Confirm booking</Button>
              <p className="secure-note"><ShieldCheck aria-hidden="true" /> {subscriptionId ? 'One eligible trip credit is reserved atomically.' : 'Payment is completed securely on the next step.'}</p>
            </form>
          </Card>
        </aside>
      </div>
    </div>
  );
}
