import { describe, expect, it } from 'vitest';
import { estimateRouteEta, haversineMeters } from './geo.js';

describe('route ETA', () => {
  const routePoints = [
    { latitude: 23.7806, longitude: 90.2794, sequence: 1 },
    { latitude: 23.7816, longitude: 90.2894, sequence: 2 },
    { latitude: 23.7916, longitude: 90.2894, sequence: 3 },
    { latitude: 23.7916, longitude: 90.2994, sequence: 4 },
  ];

  it('uses distance along the route rather than direct point distance', () => {
    const result = estimateRouteEta({
      current: routePoints[0]!,
      routePoints,
      destinationSequence: 4,
      recentAverageSpeedKph: 20,
    });
    const direct = haversineMeters(routePoints[0]!, routePoints[3]!);

    expect(result).not.toBeNull();
    expect(result!.remainingMeters).toBeGreaterThan(direct);
    expect(result!.minutes).toBeGreaterThan(0);
  });

  it('applies active traffic and schedule delay factors', () => {
    const normal = estimateRouteEta({ current: routePoints[0]!, routePoints, destinationSequence: 4, reportedSpeedKph: 25 });
    const delayed = estimateRouteEta({
      current: routePoints[0]!,
      routePoints,
      destinationSequence: 4,
      reportedSpeedKph: 25,
      trafficMultiplier: 1.5,
      scheduleDelayMinutes: 4,
    });

    expect(delayed!.minutes).toBeGreaterThan(normal!.minutes + 3);
  });

  it('returns null when the destination is not on a usable path', () => {
    expect(estimateRouteEta({ current: routePoints[0]!, routePoints, destinationSequence: 99 })).toBeNull();
  });
});
