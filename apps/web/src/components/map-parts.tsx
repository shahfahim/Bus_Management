import L, { type LatLngExpression } from 'leaflet';
import { useEffect, useRef } from 'react';
import { TileLayer, useMap } from 'react-leaflet';

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
