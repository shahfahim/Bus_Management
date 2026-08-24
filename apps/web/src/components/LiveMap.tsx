import L, { type LatLngExpression } from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { useSocket } from '../contexts/SocketContext';
import type { Coordinates, RoadAlert, Route, Stop, Trip } from '../types';

const DEFAULT_CENTER: LatLngExpression = [23.7806, 90.407];
const busIcon = L.divIcon({
  className: 'bus-map-marker',
  html: '<span aria-hidden="true">🚌</span>',
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});

function FitMap({ positions }: { positions: LatLngExpression[] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 1) map.setView(positions[0], 15);
    if (positions.length > 1) map.fitBounds(L.latLngBounds(positions), { padding: [38, 38], maxZoom: 16 });
  }, [map, positions]);
  return null;
}

export function RouteMap({
  route,
  busLocation,
  alerts = [],
  className,
}: {
  route?: Route;
  busLocation?: Coordinates;
  alerts?: RoadAlert[];
  className?: string;
}) {
  const routePath = useMemo<LatLngExpression[]>(() => {
    if (route?.path?.length) return route.path;
    return route?.stops?.map((stop) => [stop.latitude, stop.longitude] as LatLngExpression) ?? [];
  }, [route]);
  const positions = useMemo(
    () => [...routePath, ...(busLocation ? ([[busLocation.latitude, busLocation.longitude]] as LatLngExpression[]) : [])],
    [busLocation, routePath],
  );
  const center = positions[0] ?? DEFAULT_CENTER;

  return (
    <div aria-label="Route map" className={`map-frame ${className ?? ''}`} role="region">
      <MapContainer center={center} scrollWheelZoom={false} zoom={13}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
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
        <FitMap positions={positions} />
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
  const [recordedAt, setRecordedAt] = useState(trip.currentLocation?.recordedAt ?? trip.bus?.currentLocation?.recordedAt);
  const { socket, connected } = useSocket();

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
        {recordedAt && <small>Updated {new Date(recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>}
      </div>
      <RouteMap alerts={alerts} busLocation={location} route={trip.route} />
    </div>
  );
}
