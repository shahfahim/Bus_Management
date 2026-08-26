import { ArrowLeft, BusFront, Crosshair, MapPin, Navigation, School } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TripLocationPicker } from '../../components/TripLocationPicker';
import { Button, Card, Field, InlineAlert, PageHeader, SelectField, Skeleton } from '../../components/ui';
import { api, errorMessage, unwrap } from '../../lib/api';
import type { Coordinates, Trip } from '../../types';

interface SetupLocation extends Coordinates { name: string; address?: string | null }
interface SetupBus {
  id: string;
  fleetNumber: string;
  registrationNumber: string;
  capacity: number;
  assignmentWindows: Array<{ startsAt: string; endsAt?: string | null }>;
}
interface SetupOptions { buses: SetupBus[]; campus: SetupLocation | null }

const localDateTime = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export function CreateDriverTripPage() {
  const [options, setOptions] = useState<SetupOptions | null>(null);
  const [origin, setOrigin] = useState<SetupLocation | null>(null);
  const [destination, setDestination] = useState<SetupLocation | null>(null);
  const [activePoint, setActivePoint] = useState<'origin' | 'destination'>('origin');
  const [busId, setBusId] = useState('');
  const [scheduledStart, setScheduledStart] = useState(() => localDateTime(new Date(Date.now() + 60 * 60_000)));
  const [scheduledEnd, setScheduledEnd] = useState(() => localDateTime(new Date(Date.now() + 2 * 60 * 60_000)));
  const [fare, setFare] = useState('0');
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const selectedBus = options?.buses.find((bus) => bus.id === busId);
  const assignmentHint = selectedBus?.assignmentWindows
    .map((window) => `${new Date(window.startsAt).toLocaleString()} – ${window.endsAt ? new Date(window.endsAt).toLocaleString() : 'open-ended'}`)
    .join(' · ');

  const loadOptions = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = unwrap(await api.get<SetupOptions | { data: SetupOptions }>('/driver/trip-setup/options'));
      setOptions(result);
      setBusId((current) => current || result.buses[0]?.id || '');
    } catch (reason) { setError(errorMessage(reason, 'Could not load your assigned buses.')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadOptions(); }, [loadOptions]);

  const updatePoint = (coordinates: Coordinates) => {
    const current = activePoint === 'origin' ? origin : destination;
    const next: SetupLocation = { ...coordinates, name: current?.name ?? (activePoint === 'origin' ? 'Custom pickup' : 'Custom destination'), address: current?.address };
    if (activePoint === 'origin') setOrigin(next); else setDestination(next);
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setError('Location access is unsupported. Select the point on the map.'); return; }
    setLocating(true); setError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { updatePoint({ latitude: coords.latitude, longitude: coords.longitude }); setLocating(false); },
      () => { setError('Allow location permission or select the point on the map.'); setLocating(false); },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 12_000 },
    );
  };
  const useCampus = () => {
    if (!options?.campus) return;
    if (activePoint === 'origin') setOrigin(options.campus); else setDestination(options.campus);
  };
  const updateLocationText = (point: 'origin' | 'destination', field: 'name' | 'address', value: string) => {
    const setter = point === 'origin' ? setOrigin : setDestination;
    setter((current) => current ? { ...current, [field]: value } : null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!origin || !destination) { setError('Select both pickup and destination on the map.'); return; }
    setSubmitting(true); setError('');
    try {
      const trip = unwrap(await api.post<Trip | { data: Trip }>('/driver/trips', {
        busId, origin, destination,
        scheduledStart: new Date(scheduledStart).toISOString(),
        scheduledEnd: new Date(scheduledEnd).toISOString(),
        fare: Number(fare),
      }));
      navigate(`/driver/trips/${trip.id}`, { replace: true });
    } catch (reason) { setError(errorMessage(reason, 'Could not create the trip.')); }
    finally { setSubmitting(false); }
  };

  if (loading) return <div className="page-stack"><PageHeader title="Set up a custom trip" /><Card><Skeleton lines={7} /></Card></div>;
  return (
    <div className="page-stack custom-trip-page">
      <PageHeader actions={<Link className="button button--ghost button--md" to="/driver/trips"><ArrowLeft aria-hidden="true" size={17} /> Back to trips</Link>} description="Choose any pickup and destination on the map, including the university campus." eyebrow="Driver operations" title="Set up a custom trip" />
      {error && <InlineAlert>{error}</InlineAlert>}
      {!options?.buses.length && <InlineAlert tone="warning">No active bus is assigned to you. Ask a transport administrator to assign a bus before creating a trip.</InlineAlert>}
      <form className="custom-trip-layout" onSubmit={handleSubmit}>
        <Card className="custom-trip-form">
          <div className="card-heading"><div><p className="eyebrow">1. Journey</p><h2>Pickup and destination</h2></div><Navigation aria-hidden="true" /></div>
          <div className="trip-point-tabs" role="tablist" aria-label="Point being selected">
            <button aria-selected={activePoint === 'origin'} onClick={() => setActivePoint('origin')} role="tab" type="button"><MapPin aria-hidden="true" size={16} /> Pickup</button>
            <button aria-selected={activePoint === 'destination'} onClick={() => setActivePoint('destination')} role="tab" type="button"><Navigation aria-hidden="true" size={16} /> Destination</button>
          </div>
          <div className="trip-location-actions">
            <Button loading={locating} onClick={useCurrentLocation} size="sm" variant="secondary" icon={<Crosshair aria-hidden="true" size={15} />}>Use my location</Button>
            {options?.campus && <Button onClick={useCampus} size="sm" variant="secondary" icon={<School aria-hidden="true" size={15} />}>Use campus</Button>}
          </div>
          <p className="field__hint">Select Pickup or Destination, then click anywhere on the map.</p>
          <div className="form-grid">
            <Field disabled={!origin} label="Pickup name" maxLength={100} onChange={(event) => updateLocationText('origin', 'name', event.target.value)} placeholder="Pickup location" required value={origin?.name ?? ''} />
            <Field disabled={!destination} label="Destination name" maxLength={100} onChange={(event) => updateLocationText('destination', 'name', event.target.value)} placeholder="Destination" required value={destination?.name ?? ''} />
            <Field disabled={!origin} label="Pickup address (optional)" maxLength={300} onChange={(event) => updateLocationText('origin', 'address', event.target.value)} value={origin?.address ?? ''} />
            <Field disabled={!destination} label="Destination address (optional)" maxLength={300} onChange={(event) => updateLocationText('destination', 'address', event.target.value)} value={destination?.address ?? ''} />
          </div>
          <div className="card-heading custom-trip-details-heading"><div><p className="eyebrow">2. Schedule</p><h2>Bus and timing</h2></div><BusFront aria-hidden="true" /></div>
          <SelectField disabled={!options?.buses.length} hint={assignmentHint ? `Assigned availability: ${assignmentHint}` : undefined} label="Assigned bus" onChange={(event) => setBusId(event.target.value)} options={options?.buses.length ? options.buses.map((bus) => ({ value: bus.id, label: `${bus.fleetNumber} · ${bus.registrationNumber} · ${bus.capacity} seats` })) : [{ value: '', label: 'No assigned buses' }]} required value={busId} />
          <div className="form-grid">
            <Field label="Departure" min={localDateTime(new Date())} onChange={(event) => setScheduledStart(event.target.value)} required type="datetime-local" value={scheduledStart} />
            <Field label="Estimated arrival" min={scheduledStart} onChange={(event) => setScheduledEnd(event.target.value)} required type="datetime-local" value={scheduledEnd} />
          </div>
          <Field label="Fare (BDT)" min="0" max="100000" onChange={(event) => setFare(event.target.value)} required step="1" type="number" value={fare} />
          <Button className="custom-trip-submit" disabled={!options?.buses.length || !origin || !destination} loading={submitting} size="lg" type="submit">Create scheduled trip</Button>
        </Card>
        <div className="custom-trip-map-panel">
          <TripLocationPicker activePoint={activePoint} destination={destination ?? undefined} onPick={updatePoint} origin={origin ?? undefined} />
          <p><MapPin aria-hidden="true" size={15} /> Currently selecting: <strong>{activePoint === 'origin' ? 'Pickup' : 'Destination'}</strong></p>
        </div>
      </form>
    </div>
  );
}
