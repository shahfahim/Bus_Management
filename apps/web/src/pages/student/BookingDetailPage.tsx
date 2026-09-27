import { ArrowLeft, Coins, Download, MapPin, RefreshCcw, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookingPass } from '../../components/BookingPass';
import { LiveTripMap } from '../../components/LiveMap';
import { Button, Card, InlineAlert, Modal, PageHeader, Pill, Skeleton, useToast } from '../../components/ui';
import { formatCredits, useCredits } from '../../hooks/useCredits';
import { api, errorMessage, unwrap } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { Booking } from '../../types';

interface CreditPaymentResponse { paymentId?: string | null; balance?: number }

export function BookingDetailPage() {
  const { bookingId = '' } = useParams();
  const { notify } = useToast();
  const { balance } = useCredits(1);
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
      setBooking(unwrap(await api.get<Booking | { data: Booking }>(`/bookings/${bookingId}`)));
    }
    catch (reason) { setError(errorMessage(reason, 'Could not load this booking.')); }
    finally { setLoading(false); }
  }, [bookingId]);
  useEffect(() => { void load(); }, [load]);

  const pay = async () => {
    setActionLoading(true);
    try {
      const response = unwrap(await api.post<CreditPaymentResponse | { data: CreditPaymentResponse }>(
        '/payments/pay',
        { bookingId },
        { 'Idempotency-Key': paymentAttemptKey.current },
      ));
      notify({ title: 'Booking paid', description: response.balance !== undefined ? `Credits left: ${formatCredits(response.balance)}.` : undefined, tone: 'success' });
      await load();
    } catch (reason) {
      notify({ title: 'Payment failed', description: errorMessage(reason), tone: 'error' });
    } finally {
      paymentAttemptKey.current = crypto.randomUUID();
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
  // Mirrors the server rule: riders can cancel only until the trip departs.
  const canCancel = ['PENDING', 'CONFIRMED'].includes(booking.status) && !booking.checkedInAt && ['SCHEDULED', 'BOARDING', 'DELAYED'].includes(booking.trip?.status ?? '');

  return (
    <div className="page-stack">
      <Link className="back-link" to="/student/bookings"><ArrowLeft aria-hidden="true" /> All bookings</Link>
      <PageHeader actions={<Button icon={<RefreshCcw aria-hidden="true" size={16} />} onClick={() => void load()} size="sm" variant="secondary">Refresh</Button>} description={`Reference ${booking.reference} · created ${formatDateTime(booking.createdAt)}`} eyebrow="Booking details" title={booking.trip?.route?.name ?? 'University shuttle'} />
      {error && <InlineAlert>{error}</InlineAlert>}
      {booking.paymentStatus !== 'SUCCESS' && booking.status === 'PENDING' && (() => {
        const short = balance !== undefined && balance < booking.totalAmount;
        return <Card className="payment-callout"><span><Coins aria-hidden="true" /></span><div><h2>Pay with your credits to confirm this seat</h2><p>{balance === undefined ? 'The fare is taken from your credit balance.' : short ? `You have ${formatCredits(balance)}; this booking needs ${formatCredits(booking.totalAmount)}. Add credits at the university office before the hold ends.` : `You have ${formatCredits(balance)}. The seat stays held until the timer ends.`}</p></div>{short ? <Link className="button button--secondary button--md" to="/student/credits">Add credits</Link> : <Button loading={actionLoading} onClick={() => void pay()}>Pay {formatCredits(booking.totalAmount)}</Button>}</Card>;
      })()}
      <div className="booking-detail-grid">
        <BookingPass booking={booking} />
        <aside className="booking-detail-sidebar">
          <Card><div className="card-heading"><h2>Journey details</h2><Pill>{booking.paymentStatus ?? 'PENDING'}</Pill></div><dl className="detail-list"><div><dt>Boarding stop</dt><dd><MapPin aria-hidden="true" /> {booking.boardingStop?.name ?? booking.trip?.route?.origin}</dd></div><div><dt>Destination</dt><dd>{booking.destinationStop?.name ?? booking.trip?.route?.destination}</dd></div><div><dt>Driver</dt><dd>{booking.trip?.driver?.name ?? 'Assigned before departure'}</dd></div><div><dt>Fare</dt><dd>{formatCredits(booking.totalAmount)}</dd></div></dl>{canCancel && <Button icon={<XCircle aria-hidden="true" size={17} />} onClick={() => setConfirmCancel(true)} variant="danger">Cancel booking</Button>}</Card>
          {booking.trip && ['BOARDING', 'IN_PROGRESS', 'DELAYED'].includes(booking.trip.status) && <LiveTripMap trip={booking.trip} />}
          {booking.paymentStatus === 'SUCCESS' && <Link className="button button--secondary button--md full-width" to="/student/credits"><Download aria-hidden="true" size={17} /> Receipt</Link>}
        </aside>
      </div>
      <Modal footer={<><Button onClick={() => setConfirmCancel(false)} variant="ghost">Keep booking</Button><Button loading={actionLoading} onClick={() => void cancel()} variant="danger">Yes, cancel</Button></>} onClose={() => setConfirmCancel(false)} open={confirmCancel} title="Release this seat?">Cancellation cannot be undone. If you paid with credits, the fare goes straight back to your balance.</Modal>
    </div>
  );
}
