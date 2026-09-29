import L, { type LatLngExpression } from 'leaflet';
import { LocateFixed } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Circle, CircleMarker, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { MyLocation } from '../hooks/useMyLocation';

// OpenStreetMap's standard tile server. It must also be allowed in the API's CSP (img-src), and
// the service worker must leave these requests to the browser (see sw.ts).
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function OsmTiles() {
  return <TileLayer attribution={OSM_ATTRIBUTION} maxZoom={19} url={OSM_TILE_URL} />;
}

/**
 * Fits the map to the given points when fitKey changes, not on every render. Live position updates
 * therefore move markers without undoing the rider's own zooming and panning.
 */
export function FitToPoints({ points, fitKey, padding = 38 }: { points: LatLngExpression[]; fitKey: string; padding?: number }) {
  const map = useMap();
  const latest = useRef(points);
  latest.current = points;
  useEffect(() => {
    const current = latest.current;
    if (current.length === 1) map.setView(current[0]!, Math.max(map.getZoom(), 15));
    if (current.length > 1) map.fitBounds(L.latLngBounds(current), { padding: [padding, padding], maxZoom: 16 });
  }, [map, fitKey, padding]);
  return null;
}

/**
 * Leaflet measures its container once; if the container is resized later (page animations, a
 * sidebar opening, rotating a phone) the map shows grey gaps. Re-measure whenever it changes.
 */
export function KeepMapSized() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/** The rider's own position: a blue dot with a circle showing how accurate the fix is. */
export function MyLocationLayer({ location }: { location: MyLocation }) {
  const { position } = location;
  if (!position) return null;
  const center: LatLngExpression = [position.latitude, position.longitude];
  return (
    <>
      {position.accuracy > 15 && (
        <Circle center={center} interactive={false} pathOptions={{ color: '#2563eb', weight: 1, fillColor: '#2563eb', fillOpacity: 0.1 }} radius={Math.min(position.accuracy, 5_000)} />
      )}
      <CircleMarker center={center} fillColor="#2563eb" fillOpacity={1} pathOptions={{ color: '#ffffff', weight: 3 }} radius={8}>
        <Tooltip direction="top" offset={[0, -8]}>You are here</Tooltip>
      </CircleMarker>
    </>
  );
}

/** Map button that brings the rider's own position into view (or asks again if it failed). */
export function LocateMeButton({ location }: { location: MyLocation }) {
  const map = useMap();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Keep clicks and scrolls on the button from panning or zooming the map underneath.
    if (!button.current) return;
    L.DomEvent.disableClickPropagation(button.current);
    L.DomEvent.disableScrollPropagation(button.current);
  }, []);
  const { position, status } = location;
  const label = position ? 'Show my location' : status === 'locating' ? 'Finding your location' : 'Try to find my location again';
  return (
    <button
      aria-label={label}
      className={`map-locate-button${status === 'locating' && !position ? ' map-locate-button--busy' : ''}`}
      onClick={() => {
        if (position) map.flyTo([position.latitude, position.longitude], Math.max(map.getZoom(), 16), { duration: 0.8 });
        else location.retry();
      }}
      ref={button}
      title={label}
      type="button"
    >
      <LocateFixed aria-hidden="true" size={18} />
    </button>
  );
}

const statusMessages: Partial<Record<MyLocation['status'], string>> = {
  denied: "Location is blocked for this site. Allow it in your browser's site settings to see where you are.",
  unavailable: 'Your device could not find your location. Turn on location services and try again.',
  unsupported: 'This browser cannot share your location.',
};

/** Explains why the blue dot is missing; shown under the map. */
export function MyLocationNotice({ location }: { location: MyLocation }) {
  const message = location.position ? undefined : statusMessages[location.status];
  if (!message) return null;
  return (
    <p className="map-location-notice" role="status">
      {message}
      {location.status !== 'unsupported' && <button className="text-button" onClick={location.retry} type="button">Try again</button>}
    </p>
  );
}
