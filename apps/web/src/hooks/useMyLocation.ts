import { useCallback, useEffect, useState } from 'react';
import type { Coordinates } from '../types';

export type MyLocationStatus = 'locating' | 'ready' | 'denied' | 'unavailable' | 'unsupported';

export interface MyLocation {
  position?: Coordinates & { accuracy: number };
  status: MyLocationStatus;
  retry: () => void;
}

/**
 * Follows the rider's own position for the maps. Asks for a precise fix first and falls back to
 * a coarse one when that times out (desktops and indoor phones often have no GPS fix), and
 * reports why nothing is shown instead of failing silently.
 */
export function useMyLocation(enabled = true): MyLocation {
  const [position, setPosition] = useState<MyLocation['position']>();
  const [status, setStatus] = useState<MyLocationStatus>('locating');
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      setStatus('unsupported');
      return undefined;
    }
    setStatus((current) => (current === 'ready' ? current : 'locating'));
    let watchId: number | undefined;
    let precise = true;

    const start = () => {
      watchId = navigator.geolocation.watchPosition(
        ({ coords }) => {
          setPosition({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy });
          setStatus('ready');
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            setStatus('denied');
          } else if (error.code === error.TIMEOUT && precise) {
            // No GPS fix in time: settle for Wi-Fi / network positioning instead.
            precise = false;
            if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
            start();
          } else {
            setStatus((current) => (current === 'ready' ? current : 'unavailable'));
          }
        },
        { enableHighAccuracy: precise, timeout: precise ? 15_000 : 30_000, maximumAge: 10_000 },
      );
    };
    start();

    // When the rider allows location in the browser's site settings, start again without a reload.
    let permission: PermissionStatus | undefined;
    const onPermissionChange = () => { if (permission?.state === 'granted') setAttempt((value) => value + 1); };
    void navigator.permissions?.query({ name: 'geolocation' })
      .then((result) => {
        permission = result;
        result.addEventListener('change', onPermissionChange);
      })
      .catch(() => undefined);

    return () => {
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
      permission?.removeEventListener('change', onPermissionChange);
    };
  }, [enabled, attempt]);

  return { position, status, retry };
}
