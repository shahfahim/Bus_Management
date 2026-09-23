import { BusFront, Info, RefreshCcw, ScanBarcode, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BoardingBarcode } from '../../components/BoardingBarcode';
import { BoardingCardTrips } from '../../components/BoardingCardTrips';
import { Brand } from '../../components/Brand';
import { Button, Card, InlineAlert, Modal, PageHeader, Skeleton, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { BoardingCard } from '../../types';

export function BoardingCardPage() {
  const [card, setCard] = useState<BoardingCard>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmReissue, setConfirmReissue] = useState(false);
  const [reissuing, setReissuing] = useState(false);
  const { notify } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setCard(await api.get<BoardingCard>('/boarding/card')); }
    catch (reason) { setError(errorMessage(reason, 'Could not load your boarding card.')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const reissue = async () => {
    setReissuing(true);
    try {
      setCard(await api.post<BoardingCard>('/boarding/card/reissue'));
      setConfirmReissue(false);
      notify({ title: 'New boarding card issued', description: 'Your previous barcode no longer works.', tone: 'success' });
    } catch (reason) {
      notify({ title: 'Could not reissue the card', description: errorMessage(reason), tone: 'error' });
    } finally {
      setReissuing(false);
    }
  };

  return (
    <div className="page-stack narrow-page">
      <PageHeader
        actions={card && <Button icon={<RefreshCcw aria-hidden="true" size={16} />} onClick={() => setConfirmReissue(true)} size="sm" variant="secondary">Reissue code</Button>}
        description="One personal barcode for every trip. Scan it at the bus door when you have a paid booking."
        eyebrow="Student travel"
        title="Boarding card"
      />
      {error && <InlineAlert>{error} <button className="text-button" onClick={() => void load()} type="button">Retry</button></InlineAlert>}
      {loading ? <Card><Skeleton lines={6} /></Card> : card && (
        <article aria-label="Your boarding card" className="boarding-card">
          <header className="boarding-card__header">
            <Brand />
            <span className="boarding-card__chip"><ScanBarcode aria-hidden="true" size={16} /> Boarding card</span>
          </header>
          <div className="boarding-card__holder">
            <div><span>Card holder</span><strong>{card.name}</strong></div>
            <div><span>Student ID</span><strong>{card.studentId}</strong></div>
          </div>
          <div className="boarding-card__barcode"><BoardingBarcode code={card.code} /></div>
          <footer className="boarding-card__footer">
            <ShieldCheck aria-hidden="true" size={16} />
            <span>Personal card · issued {formatDateTime(card.issuedAt)}. Do not share it.</span>
          </footer>
        </article>
      )}
      {card && <BoardingCardTrips />}
      <Card className="boarding-card-help">
        <h2><Info aria-hidden="true" size={18} /> How boarding works</h2>
        <ol>
          <li><strong>Book and pay</strong> for a seat on the trip you want. <Link to="/student/routes">Find a bus</Link></li>
          <li><strong>Hold this barcode under the reader</strong> at the bus door. Turn your screen brightness up if it struggles to read.</li>
          <li><strong>Each booking works once.</strong> After you board, that booking is used; book again for your next ride.</li>
        </ol>
        <p><BusFront aria-hidden="true" size={16} /> The reader only lets you in on the bus your paid booking is for.</p>
      </Card>
      <Modal
        description="Use this if your card was lost, photographed or shared."
        footer={<><Button onClick={() => setConfirmReissue(false)} variant="ghost">Keep current card</Button><Button loading={reissuing} onClick={() => void reissue()} variant="danger">Issue a new code</Button></>}
        onClose={() => setConfirmReissue(false)}
        open={confirmReissue}
        title="Reissue your boarding card?"
      >
        Your current barcode stops working immediately, including any printed copies. Your bookings are not affected.
      </Modal>
    </div>
  );
}
