export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface RoutePoint extends GeoPoint {
  sequence: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

export const haversineMeters = (a: GeoPoint, b: GeoPoint): number => {
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const firstLatitude = radians(a.latitude);
  const secondLatitude = radians(b.latitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(value));
};

interface Projection {
  t: number;
  distanceToSegmentMeters: number;
  projected: GeoPoint;
}

const projectToSegment = (point: GeoPoint, start: GeoPoint, end: GeoPoint): Projection => {
  const latitudeScale = 111_320;
  const longitudeScale = 111_320 * Math.cos(radians((start.latitude + end.latitude) / 2));
  const endX = (end.longitude - start.longitude) * longitudeScale;
  const endY = (end.latitude - start.latitude) * latitudeScale;
  const pointX = (point.longitude - start.longitude) * longitudeScale;
  const pointY = (point.latitude - start.latitude) * latitudeScale;
  const lengthSquared = endX * endX + endY * endY;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (pointX * endX + pointY * endY) / lengthSquared));
  const projected = {
    latitude: start.latitude + (end.latitude - start.latitude) * t,
    longitude: start.longitude + (end.longitude - start.longitude) * t,
  };
  return { t, distanceToSegmentMeters: haversineMeters(point, projected), projected };
};

export interface EtaEstimate {
  minutes: number;
  remainingMeters: number;
  matchedSegment: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Estimates arrival along the configured route geometry. This deliberately sums
 * remaining route segments instead of treating the bus and stop as a straight line.
 */
export const estimateRouteEta = ({
  current,
  routePoints,
  destinationSequence,
  reportedSpeedKph,
  recentAverageSpeedKph,
  trafficMultiplier = 1,
  scheduleDelayMinutes = 0,
}: {
  current: GeoPoint;
  routePoints: RoutePoint[];
  destinationSequence: number;
  reportedSpeedKph?: number | null;
  recentAverageSpeedKph?: number | null;
  trafficMultiplier?: number;
  scheduleDelayMinutes?: number;
}): EtaEstimate | null => {
  const ordered = [...routePoints].sort((a, b) => a.sequence - b.sequence);
  const destinationIndex = ordered.findIndex((point) => point.sequence === destinationSequence);
  if (ordered.length < 2 || destinationIndex <= 0) return null;

  let best:
    | (Projection & {
        segmentIndex: number;
      })
    | undefined;
  for (let index = 0; index < destinationIndex; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    if (!start || !end) continue;
    const projection = projectToSegment(current, start, end);
    if (!best || projection.distanceToSegmentMeters < best.distanceToSegmentMeters) {
      best = { ...projection, segmentIndex: index };
    }
  }
  if (!best) return null;

  const segmentEnd = ordered[best.segmentIndex + 1];
  if (!segmentEnd) return null;
  let remainingMeters = haversineMeters(best.projected, segmentEnd);
  for (let index = best.segmentIndex + 1; index < destinationIndex; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    if (start && end) remainingMeters += haversineMeters(start, end);
  }

  const validSpeed = (speed: number | null | undefined): speed is number =>
    speed !== null && speed !== undefined && Number.isFinite(speed) && speed >= 3 && speed <= 100;
  const speedKph = validSpeed(recentAverageSpeedKph)
    ? recentAverageSpeedKph
    : validSpeed(reportedSpeedKph)
      ? reportedSpeedKph
      : 22;
  const adjustedHours = (remainingMeters / 1000 / speedKph) * Math.max(0.8, Math.min(3, trafficMultiplier));
  const minutes = Math.max(0, adjustedHours * 60 + Math.max(0, scheduleDelayMinutes));
  const confidence =
    best.distanceToSegmentMeters <= 100 && validSpeed(recentAverageSpeedKph)
      ? 'HIGH'
      : best.distanceToSegmentMeters <= 500
        ? 'MEDIUM'
        : 'LOW';

  return {
    minutes: Math.round(minutes * 10) / 10,
    remainingMeters: Math.round(remainingMeters),
    matchedSegment: best.segmentIndex,
    confidence,
  };
};
