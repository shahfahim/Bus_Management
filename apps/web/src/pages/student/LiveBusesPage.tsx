import { MapIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { GlobalLiveMap } from '../../components/LiveMap';
import { PageHeader } from '../../components/ui';
import { useSocket } from '../../contexts/SocketContext';
import { api, asItems, errorMessage } from '../../lib/api';
import type { Trip } from '../../types';

export function LiveBusesPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { socket, connected } = useSocket();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const activeTrips = asItems<Trip>(await api.get<unknown>('/trips?status=IN_PROGRESS&status=SCHEDULED&status=DELAYED&pageSize=200'));
      setTrips(activeTrips);
    } catch (reason) {
      setError(errorMessage(reason, 'Could not load live buses.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!socket) return undefined;
    const interval = setInterval(() => void load(), 30_000); // refresh every 30s to catch new trips
    const updateLocation = (payload: { tripId: string; latitude: number; longitude: number; recordedAt: string }) => {
      setTrips((current) =>
        current.map((trip) =>
          trip.id === payload.tripId
            ? {
                ...trip,
                currentLocation: { latitude: payload.latitude, longitude: payload.longitude, recordedAt: payload.recordedAt },
              }
            : trip
        )
      );
    };
    socket.on('trip:location', updateLocation);
    return () => {
      clearInterval(interval);
      socket.off('trip:location', updateLocation);
    };
  }, [socket, load]);

  const activeBuses = trips.filter((t) => t.status === 'IN_PROGRESS' || t.status === 'DELAYED');

  return (
    <div className="page-stack">
      <PageHeader
        description="Monitor the real-time location of all active buses on campus."
        eyebrow="Campus fleet"
        title="Live buses"
      />
      {error && <div className="alert alert--danger">{error}</div>}
      
      <div className="routes-map-layout" style={{ height: '70vh' }}>
        <div className="routes-map-list" style={{ overflowY: 'auto' }}>
          <div className="live-map__status" style={{ padding: '16px', background: 'var(--surface-sunken)', borderBottom: '1px solid var(--border)' }}>
            <span className={connected ? 'live-dot' : 'connection-dot'} />
            <span>{connected ? 'Real-time updates active' : 'Connecting...'}</span>
          </div>
          {loading ? (
            <div style={{ padding: '16px' }}>Loading fleet data...</div>
          ) : trips.length === 0 ? (
            <div style={{ padding: '16px' }}>No scheduled or active trips found.</div>
          ) : (
            trips.map((trip) => {
              const isLive = trip.status === 'IN_PROGRESS' || trip.status === 'DELAYED';
              const hasLocation = !!trip.currentLocation;
              return (
                <div key={trip.id} className="map-trip-option" style={{ pointerEvents: 'none' }}>
                  <span>
                    <strong>{trip.route?.name}</strong>
                    <small>
                      Bus {trip.bus?.registrationNumber} · {trip.driver?.name}
                    </small>
                  </span>
                  {isLive && hasLocation ? (
                    <span className="live-dot" title="Live location available" />
                  ) : (
                    <small style={{ color: 'var(--text-muted)' }}>Location unavailable</small>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div className="map-frame" style={{ position: 'relative', overflow: 'hidden' }}>
          <GlobalLiveMap trips={trips} />
          {activeBuses.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-sunken)', zIndex: 10 }}>
              <EmptyMapPlaceholder />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyMapPlaceholder() {
  return (
    <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
      <MapIcon size={48} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
      <p>No buses currently broadcasting location.</p>
    </div>
  );
}
