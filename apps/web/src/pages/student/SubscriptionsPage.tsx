import { BadgeCheck, CalendarClock, RefreshCcw, Ticket } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, EmptyState, InlineAlert, PageHeader, Pill, Skeleton, useToast } from '../../components/ui';
import { api, asItems, errorMessage, unwrap } from '../../lib/api';
import { formatDateTime, formatMoney } from '../../lib/format';
import type { StudentSubscription, SubscriptionPlan } from '../../types';

interface CheckoutResponse { checkoutUrl?: string; url?: string }

const planRoutes = (plan: SubscriptionPlan) => plan.routes.map((item) => ('route' in item ? item.route : item));

export function SubscriptionsPage() {
  const [searchParams] = useSearchParams();
  const { notify } = useToast();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscriptions, setSubscriptions] = useState<StudentSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string>();
  const [error, setError] = useState('');
  const attemptKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [planResponse, subscriptionResponse] = await Promise.all([
        api.get<unknown>('/subscription-plans'),
        api.get<unknown>('/subscriptions'),
      ]);
      setPlans(asItems<SubscriptionPlan>(planResponse));
      setSubscriptions(asItems<StudentSubscription>(subscriptionResponse));
    } catch (reason) {
      setError(errorMessage(reason, 'Could not load bus passes.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const buy = async (plan: SubscriptionPlan) => {
    setBuying(plan.id);
    let attemptKey = attemptKeys.current.get(plan.id);
    if (!attemptKey) {
      attemptKey = crypto.randomUUID();
      attemptKeys.current.set(plan.id, attemptKey);
    }
    try {
      const checkout = unwrap(await api.post<CheckoutResponse | { data: CheckoutResponse }>(
        '/payments/checkout',
        {
          subscriptionPlanId: plan.id,
          successUrl: `${window.location.origin}/student/subscriptions?checkout=success`,
          cancelUrl: `${window.location.origin}/student/subscriptions?checkout=cancelled`,
        },
        { 'Idempotency-Key': attemptKey },
      ));
      const checkoutUrl = checkout.checkoutUrl ?? checkout.url;
      if (!checkoutUrl) throw new Error('The payment provider did not return a checkout link.');
      window.location.assign(checkoutUrl);
    } catch (reason) {
      attemptKeys.current.delete(plan.id);
      notify({ title: 'Pass checkout could not start', description: errorMessage(reason), tone: 'error' });
      setBuying(undefined);
    }
  };

  const activePlanIds = new Set(subscriptions.filter(({ status }) => status === 'ACTIVE').map(({ plan }) => plan.id));
  const callback = searchParams.get('checkout');

  return (
    <div className="page-stack">
      <PageHeader
        actions={<Button icon={<RefreshCcw aria-hidden="true" size={16} />} onClick={() => void load()} size="sm" variant="secondary">Refresh</Button>}
        description="Purchase route passes securely and track active or previous subscriptions."
        eyebrow="Student travel"
        title="Bus passes"
      />
      {callback === 'success' && <InlineAlert tone="success">Payment returned successfully. The pass activates only after verified server confirmation.</InlineAlert>}
      {callback === 'cancelled' && <InlineAlert tone="warning">Pass checkout was cancelled; no card details were stored.</InlineAlert>}
      {error && <InlineAlert>{error}</InlineAlert>}
      {loading ? <Card><Skeleton lines={8} /></Card> : (
        <>
          <section className="page-stack" aria-labelledby="available-passes"><div className="card-heading"><div><h2 id="available-passes">Available passes</h2><p>Coverage is limited to the routes shown on each plan.</p></div></div>
            {plans.length === 0 ? <Card><EmptyState icon={<Ticket />} title="No passes available" description="Transport administrators have not published a subscription plan." /></Card> : <div className="booking-list">{plans.map((plan) => {
              const routes = planRoutes(plan);
              const active = activePlanIds.has(plan.id);
              return <Card key={plan.id} style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                  <div>
                    <h2 style={{ fontSize: '1.1rem', marginBottom: '4px' }}>{plan.name}</h2>
                    <p style={{ margin: 0, fontSize: '0.78rem' }}>{plan.description ?? `${plan.durationDays}-day university transport pass`}</p>
                  </div>
                  <Pill tone={active ? 'positive' : undefined}>{active ? 'ACTIVE' : plan.code}</Pill>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 18px', color: 'var(--ink-soft)', fontSize: '0.72rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><CalendarClock aria-hidden="true" size={14} style={{ color: 'var(--primary)' }} /> {plan.durationDays} days</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Ticket aria-hidden="true" size={14} style={{ color: 'var(--primary)' }} /> {plan.tripLimit == null ? 'Unlimited trips' : `${plan.tripLimit} trips`}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', maxWidth: '100%' }}>{routes.length ? routes.map(({ code }) => code).join(', ') : 'No routes assigned'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px', paddingTop: '16px', borderTop: '1px solid var(--line)' }}>
                  <strong style={{ fontSize: '1.1rem', color: 'var(--ink)' }}>{formatMoney(Number(plan.price), plan.currency)}</strong>
                  <Button disabled={active || routes.length === 0} loading={buying === plan.id} onClick={() => void buy(plan)}>{active ? 'Already active' : 'Buy pass'}</Button>
                </div>
              </Card>;
            })}</div>}
          </section>
          <section className="page-stack" aria-labelledby="pass-history"><div className="card-heading"><div><h2 id="pass-history">Pass history</h2><p>Active, pending, expired, and cancelled subscriptions.</p></div></div>
            {subscriptions.length === 0 ? <Card><EmptyState icon={<BadgeCheck />} title="No pass history" description="Purchased bus passes will appear here." /></Card> : <div className="booking-list">{subscriptions.map((subscription) => <Card key={subscription.id} style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                <div>
                  <h2 style={{ fontSize: '0.95rem', marginBottom: '2px' }}>{subscription.plan.name}</h2>
                  <p style={{ margin: 0, fontSize: '0.68rem', fontFamily: 'monospace' }}>{subscription.reference}</p>
                </div>
                <Pill tone={subscription.status === 'ACTIVE' ? 'positive' : undefined}>{subscription.status}</Pill>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', color: 'var(--ink-soft)', fontSize: '0.7rem' }}>
                <span>Starts {formatDateTime(subscription.startsAt)}</span>
                <span>Ends {formatDateTime(subscription.endsAt)}</span>
                <strong style={{ color: 'var(--ink)' }}>{subscription.remainingTrips == null ? 'Unlimited trips' : `${subscription.remainingTrips} trips remaining`}</strong>
              </div>
            </Card>)}</div>}
          </section>
        </>
      )}
    </div>
  );
}
