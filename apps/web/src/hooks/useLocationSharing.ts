import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';

interface LocationState {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  recordedAt: string;
}

interface SharingState {
  latest: LocationState | null;
  error: string | null;
  permission: PermissionState | 'unknown';
  lastSentAt: string | null;
}

export function useLocationSharing(tripId: string | undefined, enabled: boolean) {
  const [state, setState] = useState<SharingState>({ latest: null, error: null, permission: 'unknown', lastSentAt: null });
  const lastSent = useRef(0);
  const pending = useRef<LocationState | null>(null);
  const sending = useRef(false);

  const send = useCallback(
    async (location: LocationState) => {
      if (!tripId || sending.current || !navigator.onLine) {
        pending.current = location;
        return;
      }
      sending.current = true;
      try {
        await api.post('/driver/location', {
          tripId,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracyMeters: location.accuracy,
          speedKph: location.speed === null ? null : location.speed * 3.6,
          heading: location.heading,
          capturedAt: location.recordedAt,
          isOfflineReplay: Date.now() - new Date(location.recordedAt).getTime() > 30_000,
        });
        lastSent.current = Date.now();
        pending.current = null;
        setState((current) => ({ ...current, lastSentAt: new Date().toISOString(), error: null }));
      } catch (error) {
        pending.current = location;
        setState((current) => ({ ...current, error: errorMessage(error, 'Could not share the latest GPS position.') }));
      } finally {
        sending.current = false;
      }
    },
    [tripId],
  );

  useEffect(() => {
    if (!enabled || !tripId) return undefined;
    if (!('geolocation' in navigator)) {
      setState((current) => ({ ...current, error: 'This device does not provide GPS location.' }));
      return undefined;
    }

    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((status) => setState((current) => ({ ...current, permission: status.state })))
      .catch(() => undefined);

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const location: LocationState = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed,
          heading: position.coords.heading,
          recordedAt: new Date(position.timestamp).toISOString(),
        };
        setState((current) => ({ ...current, latest: location, error: null, permission: 'granted' }));
        const moving = (position.coords.speed ?? 0) > 1.5;
        const interval = document.hidden ? 60_000 : moving ? 10_000 : 30_000;
        if (Date.now() - lastSent.current >= interval) void send(location);
      },
      (locationError) => {
        const message =
          locationError.code === locationError.PERMISSION_DENIED
            ? 'Location permission is required while a trip is active.'
            : 'GPS signal is unavailable. The last position will remain visible.';
        setState((current) => ({ ...current, error: message, permission: locationError.code === 1 ? 'denied' : current.permission }));
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );

    const retryPending = () => {
      if (pending.current) void send(pending.current);
    };
    window.addEventListener('online', retryPending);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.removeEventListener('online', retryPending);
    };
  }, [enabled, send, tripId]);

  return state;
}
