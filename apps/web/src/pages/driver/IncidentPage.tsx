import { AlertOctagon, Camera, LocateFixed, Radio, Send, ShieldAlert } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Field, InlineAlert, PageHeader, SelectField, TextAreaField, useToast } from '../../components/ui';
import { api, asItems, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { Trip } from '../../types';

export function IncidentPage() {
  const [searchParams] = useSearchParams();
  const initialTripId = searchParams.get('tripId') ?? '';
  const [trips, setTrips] = useState<Trip[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [sentAt, setSentAt] = useState('');
  const [locationStatus, setLocationStatus] = useState('A current GPS snapshot will be requested when you submit.');
  const [tripLoadError, setTripLoadError] = useState('');
  const { notify } = useToast();
  useEffect(() => {
    api.get<unknown>('/driver/trips?active=true&pageSize=30')
      .then((value) => setTrips(asItems<Trip>(value)))
      .catch((reason) => setTripLoadError(errorMessage(reason, 'Active trips could not be loaded. You can still submit a general report.')));
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSubmitting(true); setSentAt('');
    const formElement = event.currentTarget;
    try {
      const position = await currentPosition().catch(() => null);
      setLocationStatus(position ? `GPS attached (±${Math.round(position.coords.accuracy)}m)` : 'GPS unavailable; report will use the trip’s last server location.');
      const form = new FormData(formElement);
      if (position) {
        form.set('latitude', String(position.coords.latitude));
        form.set('longitude', String(position.coords.longitude));
        form.set('accuracy', String(position.coords.accuracy));
        form.set('recordedAt', new Date(position.timestamp).toISOString());
      }
      await api.post('/driver/incidents', form);
      const timestamp = new Date().toISOString(); setSentAt(timestamp); formElement.reset();
      notify({ title: 'Report sent to transport control', description: 'Affected routes can now be assessed and students notified.', tone: 'success' });
    } catch (reason) { notify({ title: 'Report could not be sent', description: errorMessage(reason), tone: 'error' }); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="page-stack narrow-page">
      <PageHeader description="Send verified route problems or emergencies to transport control." eyebrow="Driver safety" title="Report an incident" />
      <InlineAlert tone="warning"><strong>Immediate danger?</strong> Contact local emergency services first, then send this report when safe. Never use this form while driving.</InlineAlert>
      {tripLoadError && <InlineAlert>{tripLoadError}</InlineAlert>}
      {sentAt && <InlineAlert tone="success"><strong>Report received at {formatDateTime(sentAt)}.</strong> Transport control has the incident details.</InlineAlert>}
      <Card className="incident-card">
        <div className="incident-card__heading"><span><AlertOctagon aria-hidden="true" /></span><div><h2>Route or safety report</h2><p>Fields marked required are sent through the secured driver API.</p></div></div>
        <form className="incident-form" onSubmit={submit}>
          <div className="form-grid"><SelectField defaultValue={initialTripId} label="Affected trip" name="tripId" options={[{ value: '', label: 'No active trip / general issue' }, ...trips.map((trip) => ({ value: trip.id, label: `${trip.route?.name} · ${formatDateTime(trip.departureTime)}` }))]} /><SelectField label="Category" name="category" options={[{ value: 'TRAFFIC', label: 'Heavy traffic' }, { value: 'ROADBLOCK', label: 'Road blocked' }, { value: 'ACCIDENT', label: 'Accident' }, { value: 'CONSTRUCTION', label: 'Construction' }, { value: 'WEATHER', label: 'Weather' }, { value: 'VEHICLE', label: 'Vehicle problem' }, { value: 'EMERGENCY', label: 'Emergency / safety' }, { value: 'OTHER', label: 'Other' }]} required /></div>
          <SelectField label="Severity" name="severity" options={[{ value: 'LOW', label: 'Low · information only' }, { value: 'MEDIUM', label: 'Medium · may cause delay' }, { value: 'HIGH', label: 'High · route likely affected' }, { value: 'CRITICAL', label: 'Critical · immediate response needed' }]} required />
          <Field label="Short summary" maxLength={120} name="title" placeholder="What happened?" required />
          <TextAreaField label="Details" maxLength={1500} name="description" placeholder="Describe the location, direction, road condition and immediate impact." required rows={5} />
          <label className="image-upload image-upload--compact"><span className="field__label">Photo (optional, only when safely stopped)</span><input accept="image/jpeg,image/png,image/webp" name="image" type="file" /><span><Camera aria-hidden="true" /> Attach road or vehicle photo</span></label>
          <div className="location-consent"><LocateFixed aria-hidden="true" /><div><strong>Location snapshot</strong><span>{locationStatus}</span></div></div>
          <Button icon={<Send aria-hidden="true" size={17} />} loading={submitting} size="lg" type="submit">Send incident report</Button>
        </form>
      </Card>
      <Card className="incident-explainer"><Radio aria-hidden="true" /><div><h3>What happens next</h3><p>Transport control receives the report and last known trip context, then can publish a road alert to affected routes. Students are notified through their configured channels.</p></div><ShieldAlert aria-hidden="true" /></Card>
    </div>
  );
}

function currentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 10_000 }));
}
