import { AlertSeverity, RoadAlertCategory, RoadAlertStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { publicRoadAlertDto } from './road-alert.service.js';

describe('public road alerts', () => {
  it('does not disclose the administrator identity', () => {
    const value = publicRoadAlertDto({
      id: 'alert-1',
      createdById: 'admin-1',
      category: RoadAlertCategory.TRAFFIC,
      severity: AlertSeverity.MODERATE,
      status: RoadAlertStatus.ACTIVE,
      title: 'Traffic delay',
      description: 'Expect a short delay',
      locationText: 'Main gate',
      latitude: null,
      longitude: null,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60_000),
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: { id: 'admin-1', name: 'Private Admin Name' },
      routes: [{ alertId: 'alert-1', routeId: 'route-1', route: { id: 'route-1', code: 'A1', name: 'Main Route' } }],
    });

    expect(value).not.toHaveProperty('createdBy');
    expect(value).not.toHaveProperty('createdById');
    expect(value.id).toBe('alert-1');
  });
});
