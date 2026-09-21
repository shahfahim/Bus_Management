import { ArrowLeft, CreditCard, Download, MapPin, RefreshCcw, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookingPass } from '../../components/BookingPass';
import { LiveTripMap } from '../../components/LiveMap';
import { Button, Card, InlineAlert, Modal, PageHeader, Pill, Skeleton, useToast } from '../../components/ui';
import { api, errorMessage, unwrap } from '../../lib/api';
import { formatDateTime, formatMoney } from '../../lib/format';
import type { Booking } from '../../types';

interface CheckoutResponse { checkoutUrl?: string; url?: string; paymentId?: string }
interface QrResponse { qrToken?: string; token?: string; expiresAt?: string }

export function BookingDetailPage() {
  const { bookingId = '' } = useParams();
  const { notify } = useToast();
  const [booking, setBooking] = useState<Booking>();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const paymentAttemptKey = useRef(crypto.randomUUID());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const current = unwrap(await api.get<Booking | { data: Booking }>(`/bookings/${bookingId}`));
      if (current.status === 'CONFIRMED' && !current.checkedInAt) {
        const qr = unwrap(await api.get<QrResponse | { data: QrResponse }>(`/bookings/${bookingId}/qr`));
        setBooking({ ...current, qrToken: qr.qrToken ?? qr.token, qrExpiresAt: qr.expiresAt });
      } else {
        setBooking(current);
      }
    }
    catch (reason) { setError(errorMessage(reason, 'Could not load this booking.')); }
    finally { setLoading(false); }
  }, [bookingId]);
  useEffect(() => { void load(); }, [load]);

  const pay = async () => {
    setActionLoading(true);
    try {
      const response = unwrap(await api.post<CheckoutResponse | { data: CheckoutResponse }>(
        '/payments/checkout',
        {
          bookingId,
          successUrl: `${window.location.origin}/student/bookings/${bookingId}?checkout=success`,
          cancelUrl: `${window.location.origin}/student/bookings/${bookingId}?checkout=cancelled`,
        },
        { 'Idempotency-Key': paymentAttemptKey.current },
      ));
      const checkoutUrl = response.checkoutUrl ?? response.url;
      if (!checkoutUrl) throw new Error('The payment provider did not return a checkout link.');
      window.location.assign(checkoutUrl);
    } catch (reason) {
      paymentAttemptKey.current = crypto.randomUUID();
      notify({ title: 'Payment could not start', description: errorMessage(reason), tone: 'error' });
      setActionLoading(false);
    }
  };

  const cancel = async () => {
    setActionLoading(true);
    try {
      setBooking(unwrap(await api.post<Booking | { data: Booking }>(`/bookings/${bookingId}/cancel`, { reason: 'Cancelled by student' })));
      setConfirmCancel(false);
      notify({ title: 'Booking cancelled', tone: 'success' });
    } catch (reason) { notify({ title: 'Could not cancel', description: errorMessage(reason), tone: 'error' }); }
    finally { setActionLoading(false); }
  };

  if (loading) return <div className="page-stack"><Skeleton lines={2} /><Card><Skeleton lines={9} /></Card></div>;
  if (!booking) return <div className="page-stack"><Link className="back-link" to="/student/bookings"><ArrowLeft /> All bookings</Link><InlineAlert>{error || 'Booking not found.'}</InlineAlert></div>;
  const canCancel = ['PENDING', 'CONFIRMED'].includes(booking.status) && !booking.checkedInAt && (new Date(booking.trip?.departureTime ?? 0).getTime() > Date.now() || ['SCHEDULED', 'BOARDING', 'IN_PROGRESS', 'DELAYED'].includes(booking.trip?.status ?? ''));

  return (
    <div className="page-stack">
      <Link className="back-link" to="/student/bookings"><ArrowLeft aria-hidden="true" /> All bookings</Link>
      <PageHeader actions={<Button icon={<RefreshCcw aria-hidden="true" size={16} />} onClick={() => void load()} size="sm" variant="secondary">Refresh</Button>} description={`Reference ${booking.reference} · created ${formatDateTime(booking.createdAt)}`} eyebrow="Booking details" title={booking.trip?.route?.name ?? 'University shuttle'} />
      {error && <InlineAlert>{error}</InlineAlert>}
      {booking.paymentStatus !== 'SUCCESS' && booking.status === 'PENDING' && <Card className="payment-callout"><span><CreditCard aria-hidden="true" /></span><div><h2>Complete payment to activate your QR pass</h2><p>Your booking remains pending until the server verifies the payment provider’s confirmation.</p></div><Button loading={actionLoading} onClick={() => void pay()}>Pay {formatMoney(booking.totalAmount, booking.currency)}</Button></Card>}
      <div className="booking-detail-grid">
        <BookingPass booking={booking} />
        <aside className="booking-detail-sidebar">
          <Card><div className="card-heading"><h2>Journey details</h2><Pill>{booking.paymentStatus ?? 'PENDING'}</Pill></div><dl className="detail-list"><div><dt>Boarding stop</dt><dd><MapPin aria-hidden="true" /> {booking.boardingStop?.name ?? booking.trip?.route?.origin}</dd></div><div><dt>Destination</dt><dd>{booking.destinationStop?.name ?? booking.trip?.route?.destination}</dd></div><div><dt>Driver</dt><dd>{booking.trip?.driver?.name ?? 'Assigned before departure'}</dd></div><div><dt>Fare</dt><dd>{formatMoney(booking.totalAmount, booking.currency)}</dd></div></dl>{canCancel && <Button icon={<XCircle aria-hidden="true" size={17} />} onClick={() => setConfirmCancel(true)} variant="danger">Cancel booking</Button>}</Card>
          {booking.trip && ['BOARDING', 'IN_PROGRESS', 'DELAYED'].includes(booking.trip.status) && <LiveTripMap trip={booking.trip} />}
          {booking.paymentStatus === 'SUCCESS' && <Link className="button button--secondary button--md full-width" to="/student/payments"><Download aria-hidden="true" size={17} /> Payment receipt</Link>}
        </aside>
      </div>
      <Modal footer={<><Button onClick={() => setConfirmCancel(false)} variant="ghost">Keep booking</Button><Button loading={actionLoading} onClick={() => void cancel()} variant="danger">Yes, cancel</Button></>} onClose={() => setConfirmCancel(false)} open={confirmCancel} title="Release this seat?">Cancellation cannot be undone. If this booking was paid, an eligible refund is initiated server-side.</Modal>
    </div>
  );
}
