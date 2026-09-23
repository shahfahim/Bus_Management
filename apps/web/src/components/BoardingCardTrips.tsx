import { ArrowRight, BusFront, CalendarClock, MapPin, Route as RouteIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext';
import { api, asItems } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { Booking } from '../types';
import { EmptyState, Pill, Skeleton } from './ui';

const REFRESH_MS = 60_000;

const boardingState = (booking: Booking) =>
  booking.status === 'CHECKED_IN'
    ? { label: 'Boarded', tone: 'positive' as const }
    : booking.status === 'CONFIRMED'
      ? { label: 'Ready to board', tone: 'positive' as const }
      : { label: 'Payment needed', tone: 'warning' as const };

/**
 * The trips this boarding card is currently good for, read live from the database. The card itself
 * only identifies the rider, so new routes, stops or reschedules show up here without a new barcode.
 */
export function BoardingCardTrips() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date>();
  const { socket } = useSocket();

  const load = useCallback(async () => {
    try {
      const response = await api.get<unknown>('/bookings?upcoming=true&pageSize=5');
      setBookings(asItems<Booking>(response).filter((booking) => ['CONFIRMED', 'PENDING', 'CHECKED_IN'].includes(booking.status)));
      setUpdatedAt(new Date());
    } catch {
      // Keep showing the last known trips; the next refresh will try again.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Refresh while the page is open, and as soon as the rider comes back to it (e.g. at the bus door).
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // Payment confirmed, boarded, cancelled or refunded: the server tells this rider right away.
  useEffect(() => {
    if (!socket) return undefined;
    const onBookingUpdated = () => void load();
    socket.on('booking:updated', onBookingUpdated);
    return () => { socket.off('booking:updated', onBookingUpdated); };
  }, [socket, load]);

  return (
    <section aria-labelledby="card-trips-heading" className="card card-trips">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Live from your bookings</p>
          <h2 id="card-trips-heading">Where this card takes you next</h2>
        </div>
        {updatedAt && <span className="card-trips__updated"><span className="live-dot" /> Updated {updatedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
      {loading ? <Skeleton lines={4} /> : bookings.length === 0 ? (
        <EmptyState
          action={<Link className="button button--primary button--md" to="/student/routes">Find a bus <ArrowRight aria-hidden="true" size={16} /></Link>}
          icon={<RouteIcon />}
          title="No upcoming trips yet"
          description="Book a seat on any route, including newly added ones, and it appears here. Your barcode stays the same."
        />
      ) : (
        <ul className="card-trips__list">
          {bookings.map((booking) => {
            const state = boardingState(booking);
            return (
              <li className="card-trips__item" key={booking.id}>
                <div className="card-trips__main">
                  <div className="card-trips__title">
                    <strong>{booking.trip?.route?.name ?? 'University shuttle'}</strong>
                    <Pill tone={state.tone}>{state.label}</Pill>
                  </div>
                  <p className="card-trips__stops">
                    <MapPin aria-hidden="true" size={14} />
                    <span>{booking.boardingStop?.name ?? booking.trip?.route?.origin}</span>
                    <ArrowRight aria-hidden="true" size={14} />
                    <span>{booking.destinationStop?.name ?? booking.trip?.route?.destination}</span>
                  </p>
                  <div className="card-trips__meta">
                    <span><CalendarClock aria-hidden="true" size={14} /> {formatDateTime(booking.trip?.departureTime)}</span>
                    <span><BusFront aria-hidden="true" size={14} /> {booking.trip?.bus?.registrationNumber ?? 'Bus to be assigned'}</span>
                    {booking.seatNumber && <span>Seat {booking.seatNumber}</span>}
                  </div>
                </div>
                <Link className="button button--secondary button--sm" to={`/student/bookings/${booking.id}`}>
                  {booking.status === 'PENDING' ? 'Pay now' : 'Details'}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="card-trips__note">Your barcode only identifies you. Routes, stops and times are checked live when you scan, so new or changed routes never need a new card.</p>
    </section>
  );
}
