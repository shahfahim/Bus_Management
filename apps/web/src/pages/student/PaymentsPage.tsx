import { Download, ReceiptText, RefreshCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, EmptyState, InlineAlert, PageHeader, Pill, SelectField, Skeleton } from '../../components/ui';
import { api, asItems, errorMessage, withQuery } from '../../lib/api';
import { formatDateTime, formatMoney } from '../../lib/format';
import type { Payment } from '../../types';

export function PaymentsPage() {
  const [searchParams] = useSearchParams();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setPayments(asItems<Payment>(await api.get<unknown>(withQuery('/payments', { status, pageSize: 30 })))); }
    catch (reason) { setError(errorMessage(reason, 'Could not load payment history.')); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { void load(); }, [load]);
  const callbackStatus = searchParams.get('status');

  return (
    <div className="page-stack">
      <PageHeader actions={<Button icon={<RefreshCcw aria-hidden="true" size={16} />} onClick={() => void load()} size="sm" variant="secondary">Refresh status</Button>} description="Verified transactions and downloadable digital receipts." eyebrow="Student account" title="Payment history" />
      {callbackStatus === 'success' && <InlineAlert tone="success">The payment provider returned successfully. The verified server status appears below.</InlineAlert>}
      {callbackStatus === 'failed' && <InlineAlert>Payment was not completed. Your card details were never handled by UniRide.</InlineAlert>}
      <div className="filter-row"><SelectField label="Payment status" onChange={(event) => setStatus(event.target.value)} options={[{ value: '', label: 'All transactions' }, { value: 'SUCCESS', label: 'Successful' }, { value: 'PENDING', label: 'Pending' }, { value: 'FAILED', label: 'Failed' }, { value: 'REFUNDED', label: 'Refunded' }]} value={status} /></div>
      {error && <InlineAlert>{error}</InlineAlert>}
      {loading ? <Card><Skeleton lines={7} /></Card> : payments.length === 0 ? <Card><EmptyState description="Successful, failed and refunded transactions will appear here." icon={<ReceiptText />} title="No payment records" /></Card> : (
        <Card className="payment-table-card"><div className="table-scroll"><table><thead><tr><th>Transaction</th><th>Booking</th><th>Date</th><th>Method</th><th>Amount</th><th>Status</th><th><span className="sr-only">Receipt</span></th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td><strong>{payment.transactionId ?? payment.id.slice(0, 10)}</strong></td><td>{payment.booking?.reference ?? payment.bookingId ?? '—'}</td><td>{formatDateTime(payment.paidAt ?? payment.createdAt)}</td><td>{payment.method ?? 'Online'}</td><td><strong>{formatMoney(payment.amount, payment.currency)}</strong></td><td><Pill>{payment.status}</Pill></td><td>{payment.receiptUrl ? <a className="icon-button" aria-label="View receipt" href={payment.receiptUrl} rel="noreferrer" target="_blank"><Download aria-hidden="true" size={17} /></a> : '—'}</td></tr>)}</tbody></table></div></Card>
      )}
    </div>
  );
}
