import { Download, ShieldCheck } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { formatDateTime } from '../lib/format';
import type { Booking } from '../types';
import { Button, InlineAlert, Pill } from './ui';

export function BookingPass({ booking }: { booking: Booking }) {
  const usable = booking.status === 'CONFIRMED' && booking.paymentStatus === 'SUCCESS' && Boolean(booking.qrToken);
  const downloadQr = () => {
    const canvas = document.getElementById(`booking-qr-${booking.id}`) as HTMLCanvasElement | null;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `uniride-${booking.reference}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <article className="travel-pass">
      <div className="travel-pass__top">
        <div>
          <span className="eyebrow">Boarding pass</span>
          <h2>{booking.trip?.route?.name ?? 'University shuttle'}</h2>
          <p>{booking.trip?.route?.origin} → {booking.trip?.route?.destination}</p>
        </div>
        <Pill>{booking.checkedInAt ? 'COMPLETED' : booking.status}</Pill>
      </div>
      <div className="travel-pass__details">
        <div><span>Departure</span><strong>{formatDateTime(booking.trip?.departureTime)}</strong></div>
        <div><span>Seat</span><strong>{booking.seatNumber}</strong></div>
        <div><span>Bus</span><strong>{booking.trip?.bus?.registrationNumber ?? 'Assigned soon'}</strong></div>
        <div><span>Reference</span><strong>{booking.reference}</strong></div>
      </div>
      {usable ? (
        <div className="travel-pass__qr">
          <div className="qr-card">
            <QRCodeCanvas
              bgColor="#ffffff"
              fgColor="#102b29"
              id={`booking-qr-${booking.id}`}
              includeMargin
              level="M"
              size={220}
              value={booking.qrToken!}
            />
          </div>
          <div>
            <ShieldCheck aria-hidden="true" />
            <h3>Scan once at the bus door</h3>
            <p>This secure code is bound to your booking. Do not share it.</p>
            {booking.qrExpiresAt && <small>Valid until {formatDateTime(booking.qrExpiresAt)}</small>}
            <Button icon={<Download aria-hidden="true" size={17} />} onClick={downloadQr} size="sm" variant="secondary">
              Save QR
            </Button>
          </div>
        </div>
      ) : booking.checkedInAt ? (
        <InlineAlert tone="success">Checked in at {formatDateTime(booking.checkedInAt)}. This QR code has been securely retired.</InlineAlert>
      ) : (
        <InlineAlert tone="warning">The QR entry pass becomes available after the booking is confirmed and paid.</InlineAlert>
      )}
    </article>
  );
}
