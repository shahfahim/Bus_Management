import { Coins, History, Landmark, Printer, ReceiptText, RefreshCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, InlineAlert, Modal, PageHeader, Pill, Skeleton } from '../../components/ui';
import { formatCredits } from '../../hooks/useCredits';
import { api, asItems, errorMessage, unwrap, withQuery } from '../../lib/api';
import { formatDateTime, formatMoney, titleCase } from '../../lib/format';
import type { CreditTransaction, CreditTransactionType, CreditWallet, Payment, PaymentReceipt } from '../../types';

const PAGE_SIZE = 15;

const typeLabel: Record<CreditTransactionType, string> = {
  TOP_UP: 'Top-up',
  BOOKING_PAYMENT: 'Bus booking',
  PASS_PURCHASE: 'Bus pass',
  REFUND: 'Refund',
  ADJUSTMENT: 'Correction',
};

export function PaymentsPage() {
  const [wallet, setWallet] = useState<CreditWallet>();
  const [history, setHistory] = useState<CreditTransaction[]>([]);
  const [page, setPage] = useState(1);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [receiptFor, setReceiptFor] = useState<Payment>();

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [walletResponse, paymentResponse] = await Promise.all([
        api.get<CreditWallet | { data: CreditWallet }>(withQuery('/credits', { pageSize: PAGE_SIZE })),
        api.get<unknown>(withQuery('/payments', { pageSize: 30 })),
      ]);
      const nextWallet = unwrap(walletResponse);
      setWallet(nextWallet);
      setHistory(nextWallet.items);
      setPage(1);
      setPayments(asItems<Payment>(paymentResponse));
    } catch (reason) { setError(errorMessage(reason, 'Could not load your credits.')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = unwrap(await api.get<CreditWallet | { data: CreditWallet }>(withQuery('/credits', { pageSize: PAGE_SIZE, page: page + 1 })));
      setHistory((current) => [...current, ...next.items]);
      setPage(page + 1);
    } catch (reason) { setError(errorMessage(reason, 'Could not load more history.')); }
    finally { setLoadingMore(false); }
  };

  const hasMore = Boolean(wallet?.pagination && history.length < wallet.pagination.total);

  return (
    <div className="page-stack">
      <PageHeader actions={<Button icon={<RefreshCcw aria-hidden="true" size={16} />} onClick={() => void load()} size="sm" variant="secondary">Refresh</Button>} description="Buy credits at the university office, then book buses and passes without paying online." eyebrow="Student account" title="Credits" />
      {error && <InlineAlert>{error}</InlineAlert>}
      {loading ? <Card><Skeleton lines={6} /></Card> : (
        <div className="credit-overview">
          <Card className="credit-balance">
            <span className="credit-balance__icon"><Coins aria-hidden="true" /></span>
            <p className="eyebrow">Available balance</p>
            <strong className="credit-balance__value">{formatCredits(wallet?.balance ?? 0)}</strong>
            <p>1 credit = ৳1. Fares and passes are paid from this balance; refunds come back here instantly.</p>
          </Card>
          <Card className="credit-howto">
            <h2><Landmark aria-hidden="true" size={18} /> How to add credits</h2>
            <ol>
              <li><strong>Pay at the university office</strong> (transport or accounts section) in cash or as the office accepts.</li>
              <li><strong>Keep your money receipt.</strong> The office records its number when adding your credits, so each receipt counts once.</li>
              <li><strong>Credits appear here right away</strong>, and you get a notification.</li>
            </ol>
          </Card>
        </div>
      )}

      <section className="page-stack" aria-labelledby="credit-history">
        <div className="card-heading"><div><h2 id="credit-history"><History aria-hidden="true" size={18} /> Credit history</h2><p>Every top-up, fare, pass and refund.</p></div></div>
        {loading ? <Card><Skeleton lines={6} /></Card> : history.length === 0 ? <Card><EmptyState description="Top-ups and spending will appear here." icon={<Coins />} title="No credit activity yet" /></Card> : (
          <Card className="payment-table-card"><div className="table-scroll"><table><thead><tr><th>Date</th><th>Activity</th><th>Details</th><th>Credits</th><th>Balance</th></tr></thead><tbody>{history.map((entry) => <tr key={entry.id}>
            <td>{formatDateTime(entry.createdAt)}</td>
            <td><Pill tone={entry.amount > 0 ? 'positive' : 'neutral'}>{typeLabel[entry.type]}</Pill></td>
            <td>{entry.type === 'TOP_UP' && entry.reference ? `Receipt ${entry.reference}` : entry.note ?? entry.reference ?? '—'}</td>
            <td className={entry.amount > 0 ? 'credit-amount credit-amount--in' : 'credit-amount'}>{entry.amount > 0 ? '+' : '−'}{Math.abs(entry.amount).toLocaleString()}</td>
            <td>{entry.balanceAfter.toLocaleString()}</td>
          </tr>)}</tbody></table></div>
          {hasMore && <div className="credit-more"><Button loading={loadingMore} onClick={() => void loadMore()} size="sm" variant="secondary">Show more</Button></div>}
          </Card>
        )}
      </section>

      <section className="page-stack" aria-labelledby="receipts">
        <div className="card-heading"><div><h2 id="receipts"><ReceiptText aria-hidden="true" size={18} /> Receipts</h2><p>One receipt for every booking or pass you paid for.</p></div></div>
        {loading ? <Card><Skeleton lines={5} /></Card> : payments.length === 0 ? <Card><EmptyState description="Receipts for bookings and passes will appear here." icon={<ReceiptText />} title="No receipts yet" /></Card> : (
          <Card className="payment-table-card"><div className="table-scroll"><table><thead><tr><th>Payment</th><th>For</th><th>Date</th><th>Paid with</th><th>Amount</th><th>Status</th><th><span className="sr-only">Receipt</span></th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td><strong>{payment.paymentNumber ?? payment.transactionId ?? payment.id.slice(0, 10)}</strong></td><td>{payment.booking?.reference ?? payment.subscription?.subscriptionNumber ?? '—'}</td><td>{formatDateTime(payment.paidAt ?? payment.createdAt)}</td><td>{payment.methodType ? titleCase(payment.methodType) : 'Card'}</td><td><strong>{formatMoney(payment.amount, payment.currency)}</strong></td><td><Pill>{payment.status}</Pill></td><td>{payment.receiptUrl ? <button aria-label="View receipt" className="icon-button" onClick={() => setReceiptFor(payment)} type="button"><ReceiptText aria-hidden="true" size={17} /></button> : '—'}</td></tr>)}</tbody></table></div></Card>
        )}
      </section>
      <ReceiptModal onClose={() => setReceiptFor(undefined)} payment={receiptFor} />
    </div>
  );
}

// Receipts are JSON from the API; show them as a readable, printable receipt instead of raw data.
function ReceiptModal({ payment, onClose }: { payment?: Payment; onClose: () => void }) {
  const [receipt, setReceipt] = useState<PaymentReceipt>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!payment) return;
    setReceipt(undefined);
    setError('');
    api.get<PaymentReceipt | { data: PaymentReceipt }>(`/payments/${payment.id}/receipt`)
      .then((response) => setReceipt(unwrap(response)))
      .catch((reason: unknown) => setError(errorMessage(reason, 'Could not load this receipt.')));
  }, [payment]);
  return (
    <Modal
      description={receipt ? `Issued ${formatDateTime(receipt.issuedAt)}` : undefined}
      footer={<><Button onClick={onClose} variant="ghost">Close</Button><Button disabled={!receipt} icon={<Printer aria-hidden="true" size={16} />} onClick={() => window.print()}>Print</Button></>}
      onClose={onClose}
      open={Boolean(payment)}
      title={receipt ? `Receipt ${receipt.receiptNumber}` : 'Receipt'}
    >
      {error ? <InlineAlert>{error}</InlineAlert> : !receipt ? <Skeleton lines={5} /> : (
        <dl className="detail-list receipt-details">
          <div><dt>Payment</dt><dd>{receipt.paymentNumber}</dd></div>
          <div><dt>Paid by</dt><dd>{receipt.payer?.name}</dd></div>
          {receipt.bookingNumber && <div><dt>Booking</dt><dd>{receipt.bookingNumber}</dd></div>}
          {receipt.subscriptionNumber && <div><dt>Travel pass</dt><dd>{receipt.subscriptionNumber}</dd></div>}
          <div><dt>Paid on</dt><dd>{formatDateTime(receipt.paidAt)}</dd></div>
          <div><dt>Paid with</dt><dd>{receipt.card ?? (receipt.method ? titleCase(receipt.method) : 'Credits')}</dd></div>
          <div><dt>Amount</dt><dd>{formatMoney(receipt.amount, receipt.currency)}</dd></div>
          {receipt.refundedAmount > 0 && <div><dt>Refunded to credits</dt><dd>{formatMoney(receipt.refundedAmount, receipt.currency)}</dd></div>}
          <div><dt>Status</dt><dd><Pill>{receipt.status}</Pill></dd></div>
        </dl>
      )}
    </Modal>
  );
}
