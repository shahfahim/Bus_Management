import L, { type LatLngExpression } from 'leaflet';
import { useEffect } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { Coordinates } from '../types';

const DEFAULT_CENTER: LatLngExpression = [23.7289, 90.3984];

function ClickHandler({ onPick }: { onPick: (coordinates: Coordinates) => void }) {
  useMapEvents({ click: ({ latlng }) => onPick({ latitude: latlng.lat, longitude: latlng.lng }) });
  return null;
}

function FitSelected({ points }: { points: LatLngExpression[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 15);
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [42, 42], maxZoom: 16 });
  }, [map, points]);
  return null;
}

export function TripLocationPicker({ origin, destination, activePoint, onPick }: {
  origin?: Coordinates;
  destination?: Coordinates;
  activePoint: 'origin' | 'destination';
  onPick: (coordinates: Coordinates) => void;
}) {
  const points = [origin, destination]
    .filter((point): point is Coordinates => Boolean(point))
    .map((point) => [point.latitude, point.longitude] as LatLngExpression);
  return (
    <div aria-label={`Map for selecting ${activePoint}`} className="map-frame trip-location-map" role="region">
      <MapContainer center={points[0] ?? DEFAULT_CENTER} scrollWheelZoom zoom={13}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <ClickHandler onPick={onPick} />
        {points.length === 2 && <Polyline pathOptions={{ color: '#0f766e', dashArray: '8 8', weight: 4 }} positions={points} />}
        {origin && <CircleMarker center={[origin.latitude, origin.longitude]} fillColor="#0f766e" fillOpacity={1} pathOptions={{ color: '#fff', weight: 3 }} radius={9}><Tooltip permanent direction="top">Pickup</Tooltip></CircleMarker>}
        {destination && <CircleMarker center={[destination.latitude, destination.longitude]} fillColor="#e29c31" fillOpacity={1} pathOptions={{ color: '#fff', weight: 3 }} radius={9}><Tooltip permanent direction="top">Destination</Tooltip></CircleMarker>}
        <FitSelected points={points} />
      </MapContainer>
    </div>
  );
}
