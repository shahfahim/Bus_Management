import { Camera, Filter, HandHeart, ImagePlus, MapPin, PackageOpen, Plus, Search } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, Field, InlineAlert, Modal, PageHeader, Pill, SelectField, Skeleton, TextAreaField, useToast } from '../../components/ui';
import { api, asItems, errorMessage, unwrap, withQuery } from '../../lib/api';
import { formatDateTime, titleCase } from '../../lib/format';
import type { LostFoundReport } from '../../types';

const categories = ['Electronics', 'Bag', 'ID / documents', 'Clothing', 'Keys', 'Books', 'Bottle', 'Other'];

export function LostFoundPage() {
  const [reports, setReports] = useState<LostFoundReport[]>([]);
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [claiming, setClaiming] = useState<LostFoundReport>();
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState('');
  const { notify } = useToast();

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setReports(asItems<LostFoundReport>(await api.get<unknown>(withQuery('/lost-found', { type, category, search, status: ['OPEN', 'POTENTIAL_MATCH'], pageSize: 30 })))); }
    catch (reason) { setError(errorMessage(reason, 'Could not load lost and found reports.')); }
    finally { setLoading(false); }
  }, [category, search, type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);

  const createReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const created = unwrap(await api.post<LostFoundReport | { data: LostFoundReport }>('/lost-found', form));
      setReports((current) => [created, ...current]);
      setReportOpen(false); setPreview('');
      notify({ title: 'Report published', description: 'We’ll notify you if the matching service finds a likely match.', tone: 'success' });
    } catch (reason) { notify({ title: 'Report not published', description: errorMessage(reason), tone: 'error' }); }
    finally { setSubmitting(false); }
  };

  const submitClaim = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!claiming) return; setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      await api.post(`/lost-found/${claiming.id}/claims`, { evidence: form.get('evidence'), contact: form.get('contact') });
      setClaiming(undefined);
      notify({ title: 'Claim submitted privately', description: 'An administrator will verify the evidence before releasing the item.', tone: 'success' });
    } catch (reason) { notify({ title: 'Claim not submitted', description: errorMessage(reason), tone: 'error' }); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="page-stack">
      <PageHeader actions={<Button icon={<Plus aria-hidden="true" size={17} />} onClick={() => setReportOpen(true)}>Report an item</Button>} description="Search community reports or securely tell transport control about an item." eyebrow="Campus care" title="Lost & found" />
      <Card className="lost-search-card"><div className="lost-search"><Field icon={<Search aria-hidden="true" size={17} />} label="Search reports" onChange={(event) => setSearch(event.target.value)} placeholder="Item, color, location…" value={search} /><SelectField label="Report type" onChange={(event) => setType(event.target.value)} options={[{ value: '', label: 'Lost and found' }, { value: 'LOST', label: 'Lost items' }, { value: 'FOUND', label: 'Found items' }]} value={type} /><SelectField label="Category" onChange={(event) => setCategory(event.target.value)} options={[{ value: '', label: 'All categories' }, ...categories.map((item) => ({ value: item, label: item }))]} value={category} /><Button icon={<Filter aria-hidden="true" size={17} />} onClick={() => void load()} variant="secondary">Apply</Button></div></Card>
      {error && <InlineAlert>{error}</InlineAlert>}
      {loading ? <div className="lost-grid"><Card><Skeleton lines={5} /></Card><Card><Skeleton lines={5} /></Card><Card><Skeleton lines={5} /></Card></div> : reports.length === 0 ? <Card><EmptyState action={<Button onClick={() => setReportOpen(true)}>Create a report</Button>} description="Try broader search terms, or report the item so matching can begin." icon={<PackageOpen />} title="No matching reports" /></Card> : (
        <div className="lost-grid">{reports.map((report) => <Card className="lost-card" key={report.id}>{report.imageUrl ? <img alt={report.title} className="lost-card__image" loading="lazy" src={report.imageUrl} /> : <div className="lost-card__image lost-card__image--empty"><ImagePlus aria-hidden="true" /></div>}<div className="lost-card__body"><div className="lost-card__labels"><Pill tone={report.type === 'FOUND' ? 'positive' : 'warning'}>{report.type}</Pill><Pill>{report.status}</Pill></div><h2>{report.title}</h2><p>{report.description}</p><div className="lost-card__meta"><span><MapPin aria-hidden="true" /> {report.location}</span><span><Camera aria-hidden="true" /> {formatDateTime(report.occurredAt)}</span></div>{report.type === 'FOUND' && report.status === 'OPEN' && <Button icon={<HandHeart aria-hidden="true" size={17} />} onClick={() => setClaiming(report)} size="sm" variant="secondary">This may be mine</Button>}{report.matchCount ? <small className="match-note">{report.matchCount} potential {report.matchCount === 1 ? 'match' : 'matches'} under review</small> : null}</div></Card>)}</div>
      )}
      <Modal onClose={() => { setReportOpen(false); setPreview(''); }} open={reportOpen} title="Report a lost or found item" description="Avoid publishing sensitive serial numbers or personal information.">
        <form className="modal-form" onSubmit={createReport}>
          <div className="form-grid"><SelectField label="Report type" name="type" options={[{ value: 'LOST', label: 'I lost an item' }, { value: 'FOUND', label: 'I found an item' }]} required /><SelectField label="Category" name="category" options={categories.map((item) => ({ value: item, label: item }))} required /></div>
          <Field label="Short title" maxLength={100} name="title" placeholder="e.g. Black water bottle" required />
          <TextAreaField label="Description" maxLength={1000} name="description" placeholder="Color, brand and identifying details that are safe to share" required rows={4} />
          <div className="form-grid"><Field label="Location" name="location" placeholder="Bus, route or stop" required /><Field label="Date and time" max={new Date().toISOString().slice(0, 16)} name="occurredAt" required type="datetime-local" /></div>
          <label className="image-upload"><span className="field__label">Photo (optional)</span><input accept="image/jpeg,image/png,image/webp" name="image" onChange={(event) => { const file = event.target.files?.[0]; setPreview(file ? URL.createObjectURL(file) : ''); }} type="file" />{preview ? <img alt="Selected item preview" src={preview} /> : <span><ImagePlus aria-hidden="true" /> Add a clear photo · JPG, PNG or WebP · up to 10 MB</span>}</label>
          <Button loading={submitting} type="submit">Publish report</Button>
        </form>
      </Modal>
      <Modal onClose={() => setClaiming(undefined)} open={Boolean(claiming)} title={`Claim “${claiming?.title ?? ''}”`} description="Your evidence is visible only to authorised administrators.">
        <form className="modal-form" onSubmit={submitClaim}><TextAreaField label="Proof of ownership" name="evidence" placeholder="Describe a detail not visible in the report, such as contents, a mark or serial suffix." required rows={4} /><Field label="Contact number" name="contact" required type="tel" /><Button loading={submitting} type="submit">Submit private claim</Button></form>
      </Modal>
    </div>
  );
}

export const lostFoundStatusLabel = (report: LostFoundReport) => titleCase(report.status);
