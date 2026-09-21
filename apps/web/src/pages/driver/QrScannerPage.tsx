import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { Camera, CameraOff, CheckCircle2, Keyboard, QrCode, RotateCcw, ShieldAlert, UserRoundCheck, CalendarDays, BusFront, UsersRound, Clock3, ScanLine } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Field, InlineAlert, PageHeader, Pill, useToast, EmptyState, Skeleton } from '../../components/ui';
import { api, errorMessage, unwrap, asItems } from '../../lib/api';
import { formatDateTime, formatTime, localDateInputValue } from '../../lib/format';
import type { Passenger, Trip } from '../../types';

interface ValidationResult {
  checkIn: { id: string; checkedInAt: string };
  passenger: Passenger;
  trip?: Trip;
}

export function QrScannerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tripId = searchParams.get('tripId') ?? undefined;
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | undefined>(undefined);
  const lastToken = useRef('');
  const [scanning, setScanning] = useState(false);
  const [validating, setValidating] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [result, setResult] = useState<ValidationResult>();
  const [manual, setManual] = useState(false);
  const { notify } = useToast();

  // Trip selection state when tripId is missing
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [tripsError, setTripsError] = useState('');

  const loadTrips = useCallback(async () => {
    if (tripId) return;
    setLoadingTrips(true); setTripsError('');
    try {
      const date = localDateInputValue();
      const response = await api.get<unknown>(`/driver/trips?date=${date}`);
      const allTrips = asItems<Trip>(response);
      setTrips(allTrips.filter(t => t.status !== 'CANCELLED' && t.status !== 'COMPLETED'));
    } catch (err) {
      setTripsError(errorMessage(err, 'Could not load your assigned trips.'));
    } finally { setLoadingTrips(false); }
  }, [tripId]);

  useEffect(() => { void loadTrips(); }, [loadTrips]);

  const stopCamera = () => {
    controlsRef.current?.stop();
    controlsRef.current = undefined;
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setScanning(false);
  };
  useEffect(() => () => stopCamera(), []);

  const validate = async (token: string) => {
    const cleanToken = token.trim();
    if (!cleanToken || cleanToken === lastToken.current) return;
    lastToken.current = cleanToken;
    stopCamera(); setValidating(true); setValidationError(''); setResult(undefined);
    try {
      const response = await api.post<ValidationResult | { data: ValidationResult }>('/driver/check-ins/scan', { qrToken: cleanToken, tripId });
      const validated = unwrap(response);
      setResult(validated);
      navigator.vibrate?.(120);
      notify({ title: 'Passenger checked in', description: `${validated.passenger.student.name} · Seat ${validated.passenger.seatNumber}`, tone: 'success' });
    } catch (reason) {
      setValidationError(errorMessage(reason, 'This QR code is invalid, expired or already used.'));
      navigator.vibrate?.([90, 60, 90]);
    } finally { setValidating(false); }
  };

  const startCamera = async () => {
    setResult(undefined); setValidationError(''); setCameraError(''); lastToken.current = '';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not available in this browser.');
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 1000 });
      setScanning(true);
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: 'environment' }, audio: false },
        videoRef.current!,
        (scanResult) => {
          if (scanResult) void validate(scanResult.getText());
        }
      );
      controlsRef.current = controls;
    } catch (reason) {
      setScanning(false);
      setCameraError(errorMessage(reason, 'Camera permission is required to scan a boarding pass.'));
    }
  };

  const submitManual = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void validate(String(form.get('token')));
  };

  const reset = () => { setResult(undefined); setValidationError(''); lastToken.current = ''; void startCamera(); };

  return (
    <div className="page-stack narrow-page">
      <PageHeader description={!tripId ? 'Select an assigned trip to start scanning.' : 'Codes are validated server-side against your assigned trip.'} eyebrow="Secure bus entry" title="Scan passenger QR" />
      
      {!tripId ? (
        <div className="trip-selection">
          {tripsError && <InlineAlert>{tripsError}</InlineAlert>}
          {loadingTrips ? (
            <div className="trip-list"><Card><Skeleton lines={4} /></Card><Card><Skeleton lines={4} /></Card></div>
          ) : trips.length === 0 ? (
            <Card><EmptyState description="You have no assigned trips today." icon={<CalendarDays />} title="No assigned trips" /></Card>
          ) : (
            <div className="driver-trip-list">
              {trips.map((trip) => (
                <Card className="driver-trip-card" key={trip.id}>
                  <div className="driver-trip-card__time"><strong>{formatTime(trip.departureTime)}</strong><span>{new Date(trip.departureTime).toLocaleDateString(undefined, { weekday: 'short' })}</span></div>
                  <div className="driver-trip-card__main">
                    <div><h2>{trip.route?.name}</h2><p>{trip.route?.origin} → {trip.route?.destination}</p></div>
                    <div className="driver-trip-card__meta">
                      <span><BusFront aria-hidden="true" /> {trip.bus?.registrationNumber}</span>
                      <span><UsersRound aria-hidden="true" /> {(trip.totalSeats ?? 0) - trip.availableSeats} passengers</span>
                      <span><Clock3 aria-hidden="true" /> {formatDateTime(trip.estimatedArrivalTime)}</span>
                    </div>
                  </div>
                  <Pill>{trip.status}</Pill>
                  <Button className="button--md" icon={<ScanLine aria-hidden="true" size={16} />} onClick={() => setSearchParams({ tripId: trip.id })}>Select to scan</Button>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
      <div className="scanner-layout">
        <Card className="scanner-card">
          <div className="scanner-viewport">
            <video aria-label="QR scanner camera preview" autoPlay muted playsInline ref={videoRef} />
            {!scanning && !result && !validating && <div className="scanner-placeholder"><QrCode aria-hidden="true" /><strong>Ready to scan</strong><span>Point the rear camera at the student’s UniRide pass.</span></div>}
            {scanning && <div className="scanner-reticle"><span /><span /><span /><span /><small>Hold the code inside the frame</small></div>}
            {validating && <div className="scanner-processing"><span className="loading-orbit" /><strong>Validating securely…</strong></div>}
            {result && <div className="scanner-result scanner-result--success"><CheckCircle2 aria-hidden="true" /><strong>Entry approved</strong><span>Duplicate use is now blocked.</span></div>}
            {validationError && <div className="scanner-result scanner-result--error"><ShieldAlert aria-hidden="true" /><strong>Entry denied</strong><span>{validationError}</span></div>}
          </div>
          {cameraError && <InlineAlert>{cameraError}</InlineAlert>}
          <div className="scanner-actions">
            {!scanning && !result && !validating && <Button icon={<Camera aria-hidden="true" size={18} />} onClick={() => void startCamera()} size="lg">Start camera</Button>}
            {scanning && <Button icon={<CameraOff aria-hidden="true" size={18} />} onClick={stopCamera} variant="secondary">Stop camera</Button>}
            {(result || validationError) && <Button icon={<RotateCcw aria-hidden="true" size={18} />} onClick={reset}>Scan next passenger</Button>}
            <Button icon={<Keyboard aria-hidden="true" size={18} />} onClick={() => setManual((value) => !value)} variant="ghost">Enter code manually</Button>
          </div>
          {manual && <form className="manual-scan" onSubmit={submitManual}><Field autoComplete="off" label="QR token" name="token" placeholder="Paste or type the signed token" required /><Button disabled={validating} type="submit">Validate code</Button></form>}
        </Card>
        {result && <Card className="checkin-receipt"><div className="checkin-receipt__icon"><UserRoundCheck aria-hidden="true" /></div><h2>{result.passenger.student.name}</h2><p>{result.passenger.student.studentId ?? result.passenger.reference}</p><dl><div><dt>Seat</dt><dd>{result.passenger.seatNumber}</dd></div><div><dt>Route</dt><dd>{result.trip?.route?.name ?? 'Assigned route'}</dd></div><div><dt>Checked in</dt><dd>{formatDateTime(result.checkIn.checkedInAt)}</dd></div></dl><Pill tone="positive">SERVER VERIFIED</Pill></Card>}
      </div>
      )}
    </div>
  );
}
