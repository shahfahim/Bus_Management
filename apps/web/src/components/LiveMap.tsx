import L, { type LatLngExpression } from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, Popup, Tooltip } from 'react-leaflet';
import { useSocket } from '../contexts/SocketContext';
import { FitToPoints, KeepMapSized, OsmTiles } from './map-parts';
import type { Coordinates, RoadAlert, Route, Stop, Trip } from '../types';

const DEFAULT_CENTER: LatLngExpression = [23.7806, 90.407];
const busIcon = L.divIcon({
  className: 'bus-map-marker',
  html: '<span aria-hidden="true">🚌</span>',
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});

const userIcon = L.divIcon({
  className: 'user-map-marker',
  html: '<span aria-hidden="true" style="font-size: 24px;">📍</span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

/** Trip states in which a bus is on the road and may be sharing its position. */
export const LIVE_TRIP_STATUSES = ['BOARDING', 'IN_PROGRESS', 'DELAYED'];

const shortTime = (value?: string) =>
  value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined;

export function RouteMap({
  route,
  busLocation,
  userLocation,
  alerts = [],
  className,
}: {
  route?: Route;
  busLocation?: Coordinates;
  userLocation?: Coordinates;
  alerts?: RoadAlert[];
  className?: string;
}) {
  const routePath = useMemo<LatLngExpression[]>(() => {
    if (route?.path?.length) return route.path;
    return route?.stops?.map((stop) => [stop.latitude, stop.longitude] as LatLngExpression) ?? [];
  }, [route]);
  const positions = useMemo(
    () => [
      ...routePath,
      ...(busLocation ? ([[busLocation.latitude, busLocation.longitude]] as LatLngExpression[]) : []),
      ...(userLocation ? ([[userLocation.latitude, userLocation.longitude]] as LatLngExpression[]) : []),
    ],
    [busLocation, userLocation, routePath],
  );
  const center = positions[0] ?? DEFAULT_CENTER;
  // Refit when the route changes or the bus / rider first appears, not on every GPS update.
  const fitKey = `${route?.id ?? ''}:${routePath.length}:${busLocation ? 'bus' : ''}:${userLocation ? 'me' : ''}`;

  return (
    <div aria-label="Route map" className={`map-frame ${className ?? ''}`} role="region">
      <MapContainer center={center} scrollWheelZoom={false} zoom={13}>
        <OsmTiles />
        <KeepMapSized />
        {routePath.length > 1 && <Polyline pathOptions={{ color: '#0f766e', opacity: 0.9, weight: 5 }} positions={routePath} />}
        {route?.stops?.map((stop: Stop, index) => (
          <CircleMarker
            center={[stop.latitude, stop.longitude]}
            fillColor={index === 0 || index === route.stops.length - 1 ? '#0f6657' : '#ffffff'}
            fillOpacity={1}
            key={stop.id}
            pathOptions={{ color: '#0f6657', weight: 3 }}
            radius={index === 0 || index === route.stops.length - 1 ? 7 : 5}
          >
            <Tooltip>{stop.name}</Tooltip>
          </CircleMarker>
        ))}
        {alerts
          .filter((alert) => alert.coordinates)
          .map((alert) => (
            <CircleMarker
              center={[alert.coordinates!.latitude, alert.coordinates!.longitude]}
              fillColor="#dc573f"
              fillOpacity={0.85}
              key={alert.id}
              pathOptions={{ color: '#fff', weight: 2 }}
              radius={9}
            >
              <Popup>
                <strong>{alert.title}</strong>
                <br />
                {alert.description}
              </Popup>
            </CircleMarker>
          ))}
        {busLocation && (
          <Marker icon={busIcon} position={[busLocation.latitude, busLocation.longitude]}>
            <Tooltip direction="top" offset={[0, -18]} permanent>
              Live bus
            </Tooltip>
          </Marker>
        )}
        {userLocation && (
          <Marker icon={userIcon} position={[userLocation.latitude, userLocation.longitude]}>
            <Tooltip direction="top" offset={[0, -12]} permanent>
              You are here
            </Tooltip>
          </Marker>
        )}
        <FitToPoints fitKey={fitKey} points={positions} />
      </MapContainer>
    </div>
  );
}

interface LiveLocationPayload extends Coordinates {
  tripId: string;
  recordedAt?: string;
  speedKph?: number;
}

export function LiveTripMap({ trip, alerts }: { trip: Trip; alerts?: RoadAlert[] }) {
  const [location, setLocation] = useState<Coordinates | undefined>(trip.currentLocation ?? trip.bus?.currentLocation);
  const [userLocation, setUserLocation] = useState<Coordinates | undefined>();
  const [recordedAt, setRecordedAt] = useState(trip.currentLocation?.recordedAt ?? trip.bus?.currentLocation?.recordedAt);
  const { socket, connected } = useSocket();

  useEffect(() => {
    if (!('geolocation' in navigator)) return undefined;
    const watchId = navigator.geolocation.watchPosition(
      (position) => setUserLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    socket.emit('trip:join', { tripId: trip.id });
    const update = (payload: LiveLocationPayload) => {
      if (payload.tripId !== trip.id) return;
      setLocation({ latitude: payload.latitude, longitude: payload.longitude });
      setRecordedAt(payload.recordedAt ?? new Date().toISOString());
    };
    socket.on('trip:location', update);
    return () => {
      socket.emit('trip:leave', { tripId: trip.id });
      socket.off('trip:location', update);
    };
  }, [socket, trip.id]);

  return (
    <div className="live-map">
      <div className="live-map__status">
        <span className={connected ? 'live-dot' : 'connection-dot'} />
        <span>{connected ? 'Live location' : 'Connecting to live location'}</span>
        {recordedAt && <small>Updated {shortTime(recordedAt)}</small>}
      </div>
      <RouteMap alerts={alerts} busLocation={location} userLocation={userLocation} route={trip.route} />
    </div>
  );
}

export function GlobalLiveMap({ trips }: { trips: Trip[] }) {
  const located = useMemo(
    () => trips.filter((trip) => LIVE_TRIP_STATUSES.includes(trip.status) && trip.currentLocation),
    [trips],
  );
  const positions = useMemo(
    () => located.map((trip) => [trip.currentLocation!.latitude, trip.currentLocation!.longitude] as LatLngExpression),
    [located],
  );
  // Refit only when buses appear or disappear, so the view stays put while they move.
  const fitKey = located.map((trip) => trip.id).sort().join(',');
  const center = positions[0] ?? DEFAULT_CENTER;

  return (
    <div aria-label="Global live map" className="map-frame" role="region">
      <MapContainer center={center} scrollWheelZoom zoom={12}>
        <OsmTiles />
        <KeepMapSized />
        {located.map((trip) => (
          <Marker key={trip.id} icon={busIcon} position={[trip.currentLocation!.latitude, trip.currentLocation!.longitude]}>
            <Tooltip direction="top" offset={[0, -18]} permanent>
              {trip.route?.name ?? 'Live bus'}
              {trip.currentLocation?.recordedAt && <small className="map-tooltip-time"> · {shortTime(trip.currentLocation.recordedAt)}</small>}
            </Tooltip>
          </Marker>
        ))}
        {positions.length > 0 && <FitToPoints fitKey={fitKey} points={positions} />}
      </MapContainer>
    </div>
  );
}
