import { CalendarClock, ChevronLeft, ChevronRight, MapPin, QrCode, SearchX, TicketCheck, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, InlineAlert, Modal, PageHeader, Pill, SelectField, Skeleton, useToast } from '../../components/ui';
import { api, asItems, errorMessage, unwrap, withQuery } from '../../lib/api';
import { formatDateTime, formatMoney } from '../../lib/format';
import type { Booking, BookingStatus } from '../../types';

export function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState('UPCOMING');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<Booking>();
  const [actionLoading, setActionLoading] = useState(false);
  const { notify } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = filter === 'UPCOMING' ? { upcoming: true, page, pageSize: 8 } : { status: filter === 'ALL' ? '' : filter, page, pageSize: 8 };
      const response = await api.get<unknown>(withQuery('/bookings', query));
      setBookings(asItems<Booking>(response));
      const pageData = unwrap(response as unknown | { data: unknown }) as {
        totalPages?: number;
        meta?: { totalPages?: number };
        pagination?: { pages?: number };
      };
      setTotalPages(pageData?.pagination?.pages ?? pageData?.totalPages ?? pageData?.meta?.totalPages ?? 1);
    } catch (reason) {
      setError(errorMessage(reason, 'Could not load your bookings.'));
    } finally {
      setLoading(false);
    }
  }, [filter, page]);
  useEffect(() => { void load(); }, [load]);

  const cancelBooking = async () => {
    if (!cancelling) return;
    setActionLoading(true);
    try {
      const response = await api.post<Booking | { data: Booking }>(`/bookings/${cancelling.id}/cancel`, { reason: 'Cancelled by student' });
      const updated = unwrap(response);
      setBookings((current) => current.map((booking) => booking.id === updated.id ? updated : booking));
      notify({ title: 'Booking cancelled', description: updated.paymentStatus === 'SUCCESS' ? 'Any eligible refund will be processed to the original payment method.' : undefined, tone: 'success' });
      setCancelling(undefined);
    } catch (reason) {
      notify({ title: 'Cancellation failed', description: errorMessage(reason), tone: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader actions={<Link className="button button--primary button--md" to="/student/routes">Find a bus</Link>} description="Open boarding passes and review every university bus journey." eyebrow="Student travel" title="My bookings" />
      <div className="filter-row">
        <SelectField label="Show" onChange={(event) => { setFilter(event.target.value); setPage(1); }} options={[
          { value: 'UPCOMING', label: 'Upcoming' }, { value: 'ALL', label: 'All bookings' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'CANCELLED', label: 'Cancelled' }, { value: 'PENDING', label: 'Awaiting payment' },
        ]} value={filter} />
      </div>
      {error && <InlineAlert>{error} <button className="text-button" onClick={() => void load()} type="button">Retry</button></InlineAlert>}
      {loading ? <div className="booking-list"><Card><Skeleton lines={4} /></Card><Card><Skeleton lines={4} /></Card></div> : bookings.length === 0 ? (
        <Card><EmptyState action={<Link className="button button--primary button--md" to="/student/routes">Browse available trips</Link>} description="When you reserve a seat, the booking and secure QR pass will appear here." icon={<SearchX />} title="No bookings here yet" /></Card>
      ) : (
        <div className="booking-list">{bookings.map((booking) => <BookingCard booking={booking} key={booking.id} onCancel={() => setCancelling(booking)} />)}</div>
      )}
      {totalPages > 1 && <div className="pagination"><Button disabled={page <= 1} icon={<ChevronLeft />} onClick={() => setPage((value) => value - 1)} size="sm" variant="secondary">Previous</Button><span>Page {page} of {totalPages}</span><Button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} size="sm" variant="secondary">Next <ChevronRight /></Button></div>}
      <Modal footer={<><Button onClick={() => setCancelling(undefined)} variant="ghost">Keep booking</Button><Button loading={actionLoading} onClick={() => void cancelBooking()} variant="danger">Cancel booking</Button></>} onClose={() => setCancelling(undefined)} open={Boolean(cancelling)} title="Cancel this booking?" description="The seat will be released immediately.">
        {cancelling && <div className="cancel-summary"><strong>{cancelling.trip?.route?.name}</strong><span>{formatDateTime(cancelling.trip?.departureTime)} · Seat {cancelling.seatNumber}</span>{cancelling.paymentStatus === 'SUCCESS' && <InlineAlert tone="info">Refund eligibility and timing are determined securely by the payment service.</InlineAlert>}</div>}
      </Modal>
    </div>
  );
}

function BookingCard({ booking, onCancel }: { booking: Booking; onCancel: () => void }) {
  const canCancel = ['PENDING', 'CONFIRMED'].includes(booking.status) && !booking.checkedInAt && new Date(booking.trip?.departureTime ?? 0).getTime() > Date.now();
  return (
    <Card className="booking-card">
      <div className="booking-card__date"><span>{new Date(booking.trip?.departureTime ?? booking.createdAt).toLocaleDateString(undefined, { month: 'short' })}</span><strong>{new Date(booking.trip?.departureTime ?? booking.createdAt).getDate()}</strong></div>
      <div className="booking-card__main"><div className="booking-card__title"><div><h2>{booking.trip?.route?.name ?? 'University shuttle'}</h2><p>{booking.reference}</p></div><Pill>{booking.status}</Pill></div><div className="booking-card__meta"><span><CalendarClock aria-hidden="true" /> {formatDateTime(booking.trip?.departureTime)}</span><span><MapPin aria-hidden="true" /> {booking.boardingStop?.name ?? booking.trip?.route?.origin}</span><span><TicketCheck aria-hidden="true" /> Seat {booking.seatNumber}</span><span>{formatMoney(booking.totalAmount, booking.currency)} · {booking.paymentStatus}</span></div></div>
      <div className="booking-card__actions"><Link className="button button--secondary button--md" to={`/student/bookings/${booking.id}`}><QrCode aria-hidden="true" size={17} /> {booking.qrToken ? 'Open pass' : 'View details'}</Link>{canCancel && <Button icon={<XCircle aria-hidden="true" size={17} />} onClick={onCancel} variant="ghost">Cancel</Button>}</div>
    </Card>
  );
}

export function statusCanCancel(status: BookingStatus) {
  return status === 'PENDING' || status === 'CONFIRMED';
}
