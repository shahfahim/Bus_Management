import { ScanBarcode } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDateTime } from '../lib/format';
import type { Booking } from '../types';
import { InlineAlert, Pill } from './ui';

// Riders board with their personal boarding card; the booking only has to be confirmed (paid).
export function BookingPass({ booking }: { booking: Booking }) {
  const ready = booking.status === 'CONFIRMED' && !booking.checkedInAt;
  return (
    <article className="travel-pass">
      <div className="travel-pass__top">
        <div>
          <span className="eyebrow">Booking</span>
          <h2>{booking.trip?.route?.name ?? 'University shuttle'}</h2>
          <p>{booking.trip?.route?.origin} → {booking.trip?.route?.destination}</p>
        </div>
        <Pill>{booking.checkedInAt ? 'CHECKED_IN' : booking.status}</Pill>
      </div>
      <div className="travel-pass__details">
        <div><span>Departure</span><strong>{formatDateTime(booking.trip?.departureTime)}</strong></div>
        <div><span>Seat</span><strong>{booking.seatNumber}</strong></div>
        <div><span>Bus</span><strong>{booking.trip?.bus?.registrationNumber ?? 'Assigned soon'}</strong></div>
        <div><span>Reference</span><strong>{booking.reference}</strong></div>
      </div>
      {ready ? (
        <div className="travel-pass__board">
          <ScanBarcode aria-hidden="true" />
          <div>
            <h3>Ready to board</h3>
            <p>Scan your personal boarding card at the door of bus {booking.trip?.bus?.registrationNumber ?? 'assigned to this trip'}. The booking is used once you board.</p>
          </div>
          <Link className="button button--primary button--md" to="/student/boarding-card">Show boarding card</Link>
        </div>
      ) : booking.checkedInAt ? (
        <InlineAlert tone="success">Boarded at {formatDateTime(booking.checkedInAt)}. This booking has been used; book again for your next ride.</InlineAlert>
      ) : booking.status === 'PENDING' ? (
        <InlineAlert tone="warning">Complete payment to board with your boarding card.</InlineAlert>
      ) : null}
    </article>
  );
}
