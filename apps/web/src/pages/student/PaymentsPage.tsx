import { Printer, ReceiptText, RefreshCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, EmptyState, InlineAlert, Modal, PageHeader, Pill, SelectField, Skeleton } from '../../components/ui';
import { api, asItems, errorMessage, unwrap, withQuery } from '../../lib/api';
import { formatDateTime, formatMoney, titleCase } from '../../lib/format';
import type { Payment, PaymentReceipt } from '../../types';

export function PaymentsPage() {
  const [searchParams] = useSearchParams();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [receiptFor, setReceiptFor] = useState<Payment>();
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setPayments(asItems<Payment>(await api.get<unknown>(withQuery('/payments', { status, pageSize: 30 })))); }
    catch (reason) { setError(errorMessage(reason, 'Could not load payment history.')); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { void load(); }, [load]);
  // Stripe returns with ?checkout=…; older links used ?status=….
  const callbackStatus = searchParams.get('checkout') ?? searchParams.get('status');

  return (
    <div className="page-stack">
      <PageHeader actions={<Button icon={<RefreshCcw aria-hidden="true" size={16} />} onClick={() => void load()} size="sm" variant="secondary">Refresh status</Button>} description="Verified transactions and digital receipts." eyebrow="Student account" title="Payment history" />
      {callbackStatus === 'success' && <InlineAlert tone="success">The payment provider returned successfully. The verified server status appears below within a few seconds.</InlineAlert>}
      {(callbackStatus === 'failed' || callbackStatus === 'cancelled') && <InlineAlert tone="warning">Payment was not completed. Your card details were never handled by UniRide.</InlineAlert>}
      <div className="filter-row"><SelectField label="Payment status" onChange={(event) => setStatus(event.target.value)} options={[{ value: '', label: 'All transactions' }, { value: 'SUCCESS', label: 'Successful' }, { value: 'PROCESSING', label: 'Processing' }, { value: 'PENDING', label: 'Pending' }, { value: 'FAILED', label: 'Failed' }, { value: 'REFUNDED', label: 'Refunded' }]} value={status} /></div>
      {error && <InlineAlert>{error}</InlineAlert>}
      {loading ? <Card><Skeleton lines={7} /></Card> : payments.length === 0 ? <Card><EmptyState description="Successful, failed and refunded transactions will appear here." icon={<ReceiptText />} title="No payment records" /></Card> : (
        <Card className="payment-table-card"><div className="table-scroll"><table><thead><tr><th>Transaction</th><th>For</th><th>Date</th><th>Method</th><th>Amount</th><th>Status</th><th><span className="sr-only">Receipt</span></th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td><strong>{payment.paymentNumber ?? payment.transactionId ?? payment.id.slice(0, 10)}</strong></td><td>{payment.booking?.reference ?? payment.subscription?.subscriptionNumber ?? '—'}</td><td>{formatDateTime(payment.paidAt ?? payment.createdAt)}</td><td>{payment.methodType ? titleCase(payment.methodType) : 'Online'}</td><td><strong>{formatMoney(payment.amount, payment.currency)}</strong></td><td><Pill>{payment.status}</Pill></td><td>{payment.receiptUrl ? <button aria-label="View receipt" className="icon-button" onClick={() => setReceiptFor(payment)} type="button"><ReceiptText aria-hidden="true" size={17} /></button> : '—'}</td></tr>)}</tbody></table></div></Card>
      )}
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
          {receipt.card && <div><dt>Card</dt><dd>{receipt.card}</dd></div>}
          <div><dt>Amount</dt><dd>{formatMoney(receipt.amount, receipt.currency)}</dd></div>
          {receipt.refundedAmount > 0 && <div><dt>Refunded</dt><dd>{formatMoney(receipt.refundedAmount, receipt.currency)}</dd></div>}
          <div><dt>Status</dt><dd><Pill>{receipt.status}</Pill></dd></div>
        </dl>
      )}
    </Modal>
  );
}
