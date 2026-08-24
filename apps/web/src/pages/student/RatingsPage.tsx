import { MessageSquareHeart, Send, Star } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, InlineAlert, Modal, PageHeader, Pill, Skeleton, TextAreaField, cx, useToast } from '../../components/ui';
import { api, asItems, errorMessage, unwrap } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { Booking, Rating } from '../../types';

export function RatingsPage() {
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [eligible, setEligible] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<Booking>();
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { notify } = useToast();

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const [ratingResult, bookingResult] = await Promise.allSettled([
      api.get<unknown>('/ratings/mine?pageSize=50'),
      api.get<unknown>('/bookings?status=COMPLETED&unrated=true&pageSize=50'),
    ]);
    if (ratingResult.status === 'fulfilled') setRatings(asItems<Rating>(ratingResult.value));
    else setError(errorMessage(ratingResult.reason));
    if (bookingResult.status === 'fulfilled') setEligible(asItems<Booking>(bookingResult.value));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || score === 0) return;
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await api.post<Rating | { data: Rating }>('/ratings', { tripId: selected.tripId, driverId: selected.trip?.driver?.id, score, comment: form.get('comment') });
      setRatings((current) => [unwrap(response), ...current]);
      setEligible((current) => current.filter((booking) => booking.id !== selected.id));
      setSelected(undefined); setScore(0);
      notify({ title: 'Thanks for the feedback', description: 'Your rating was submitted.', tone: 'success' });
    } catch (reason) { notify({ title: 'Rating not submitted', description: errorMessage(reason), tone: 'error' }); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="page-stack">
      <PageHeader description="Share constructive feedback after a completed journey." eyebrow="Student travel" title="Driver ratings" />
      {error && <InlineAlert>{error}</InlineAlert>}
      {loading ? <Card><Skeleton lines={6} /></Card> : (
        <>
          {eligible.length > 0 && <section><div className="section-heading"><div><p className="eyebrow">Ready for feedback</p><h2>Recent journeys</h2></div></div><div className="rating-eligible-grid">{eligible.map((booking) => <Card className="eligible-rating" key={booking.id}><div><strong>{booking.trip?.driver?.name ?? 'Assigned driver'}</strong><span>{booking.trip?.route?.name}</span><small>{formatDateTime(booking.trip?.departureTime)}</small></div><Button icon={<Star aria-hidden="true" size={17} />} onClick={() => setSelected(booking)} size="sm">Rate trip</Button></Card>)}</div></section>}
          <section><div className="section-heading"><div><p className="eyebrow">Your feedback</p><h2>Submitted ratings</h2></div></div>{ratings.length === 0 ? <Card><EmptyState description="Ratings can be submitted once per completed trip." icon={<MessageSquareHeart />} title="No ratings submitted" /></Card> : <div className="review-list">{ratings.map((rating) => <Card className="review-card" key={rating.id}><div className="review-card__top"><div><strong>{rating.driver?.name ?? 'Driver'}</strong><span>{formatDateTime(rating.createdAt)}</span></div><Pill tone="info">{rating.score}/5</Pill></div><StarRow score={rating.score} /><p>{rating.comment || 'No written comment.'}</p></Card>)}</div>}</section>
        </>
      )}
      <Modal onClose={() => { setSelected(undefined); setScore(0); }} open={Boolean(selected)} title={`Rate ${selected?.trip?.driver?.name ?? 'your driver'}`} description={selected?.trip?.route?.name}>
        <form className="rating-form" onSubmit={submit}>
          <fieldset><legend>Overall rating</legend><div className="star-input">{[1, 2, 3, 4, 5].map((value) => <button aria-label={`${value} star${value > 1 ? 's' : ''}`} className={cx(value <= score && 'star-input--active')} key={value} onClick={() => setScore(value)} type="button"><Star aria-hidden="true" /></button>)}</div></fieldset>
          <TextAreaField label="Comment (optional)" maxLength={600} name="comment" placeholder="What went well, or what could improve?" rows={4} />
          <Button disabled={score === 0} icon={<Send aria-hidden="true" size={17} />} loading={submitting} type="submit">Submit rating</Button>
        </form>
      </Modal>
    </div>
  );
}

function StarRow({ score }: { score: number }) {
  return <div aria-label={`${score} out of 5 stars`} className="star-row">{[1, 2, 3, 4, 5].map((value) => <Star aria-hidden="true" className={value <= score ? 'star-filled' : ''} key={value} size={17} />)}</div>;
}
