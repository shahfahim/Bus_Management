import { BadgeCheck, CalendarClock, Coins, RefreshCcw, Ticket } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, InlineAlert, Modal, PageHeader, Pill, Skeleton, useToast } from '../../components/ui';
import { formatCredits, useCredits } from '../../hooks/useCredits';
import { api, asItems, errorMessage, unwrap } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { StudentSubscription, SubscriptionPlan } from '../../types';

interface CreditPaymentResponse { balance?: number }

const planRoutes = (plan: SubscriptionPlan) => plan.routes.map((item) => ('route' in item ? item.route : item));

export function SubscriptionsPage() {
  const { notify } = useToast();
  const { balance } = useCredits(1);
  const [confirmPlan, setConfirmPlan] = useState<SubscriptionPlan>();
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
      const result = unwrap(await api.post<CreditPaymentResponse | { data: CreditPaymentResponse }>(
        '/payments/pay',
        { subscriptionPlanId: plan.id },
        { 'Idempotency-Key': attemptKey },
      ));
      notify({ title: `${plan.name} is active`, description: result.balance !== undefined ? `Credits left: ${formatCredits(result.balance)}.` : undefined, tone: 'success' });
      setConfirmPlan(undefined);
      await load();
    } catch (reason) {
      notify({ title: 'Could not buy this pass', description: errorMessage(reason), tone: 'error' });
    } finally {
      attemptKeys.current.delete(plan.id);
      setBuying(undefined);
    }
  };

  const activePlanIds = new Set(subscriptions.filter(({ status }) => status === 'ACTIVE').map(({ plan }) => plan.id));

  return (
    <div className="page-stack">
      <PageHeader
        actions={<Button icon={<RefreshCcw aria-hidden="true" size={16} />} onClick={() => void load()} size="sm" variant="secondary">Refresh</Button>}
        description="Buy route passes with your credits and track active or previous passes."
        eyebrow="Student travel"
        title="Bus passes"
      />
      {balance !== undefined && <div className="credit-line"><span><Coins aria-hidden="true" size={15} /> Your credits</span><strong>{formatCredits(balance)}</strong></div>}
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
                  <strong style={{ fontSize: '1.1rem', color: 'var(--ink)' }}>{formatCredits(Number(plan.price))}</strong>
                  {!active && balance !== undefined && balance < Number(plan.price)
                    ? <Link className="button button--secondary button--md" to="/student/credits">Add credits</Link>
                    : <Button disabled={active || routes.length === 0} loading={buying === plan.id} onClick={() => setConfirmPlan(plan)}>{active ? 'Already active' : 'Buy pass'}</Button>}
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
      <Modal
        description={confirmPlan ? `${confirmPlan.durationDays} days · ${confirmPlan.tripLimit == null ? 'unlimited trips' : `${confirmPlan.tripLimit} trips`}` : undefined}
        footer={<><Button onClick={() => setConfirmPlan(undefined)} variant="ghost">Not now</Button><Button loading={Boolean(confirmPlan && buying === confirmPlan.id)} onClick={() => confirmPlan && void buy(confirmPlan)}>Pay {confirmPlan ? formatCredits(Number(confirmPlan.price)) : ''}</Button></>}
        onClose={() => setConfirmPlan(undefined)}
        open={Boolean(confirmPlan)}
        title={confirmPlan ? `Buy ${confirmPlan.name}?` : 'Buy pass'}
      >
        {confirmPlan && balance !== undefined
          ? `${formatCredits(Number(confirmPlan.price))} will be taken from your credits, leaving ${formatCredits(balance - Number(confirmPlan.price))}. The pass starts right away.`
          : 'The price will be taken from your credits and the pass starts right away.'}
      </Modal>
    </div>
  );
}
