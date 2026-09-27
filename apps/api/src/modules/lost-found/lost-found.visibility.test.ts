import { LostFoundReportType, LostFoundStatus, Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findReport: vi.fn() }));

vi.mock('../../lib/prisma.js', () => ({ prisma: { lostFoundReport: { findUnique: mocks.findReport } } }));
vi.mock('../admin/audit.service.js', () => ({ writeAuditLog: vi.fn() }));
vi.mock('../notifications/notification.service.js', () => ({ notifyUser: vi.fn(), notifyUsers: vi.fn() }));
vi.mock('./lost-found.upload.js', () => ({ removeLostFoundUrls: vi.fn() }));

import { getLostFound } from './lost-found.service.js';

const report = {
  id: '00000000-0000-4000-8000-000000000001',
  reportNumber: 'LNF-1',
  reporterId: 'reporter-1',
  reporter: { id: 'reporter-1', name: 'Reporter', avatarUrl: null },
  verifiedById: 'admin-1',
  verifiedBy: { id: 'admin-1', name: 'Reviewing Admin' },
  verificationNotes: 'Internal: caller sounded unsure, check CCTV',
  type: LostFoundReportType.FOUND,
  status: LostFoundStatus.OPEN,
  category: 'Bag',
  title: 'Black backpack',
  description: 'Found on bus 1',
  color: null,
  brand: null,
  locationText: 'Bus 1',
  happenedAt: new Date(),
  latitude: null,
  longitude: null,
  verifiedAt: new Date(),
  closedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  images: [],
  _count: { lostMatches: 0, foundMatches: 0, claims: 0 },
};

describe('lost-and-found visibility', () => {
  beforeEach(() => mocks.findReport.mockResolvedValue(report));

  it('hides reviewer notes, reviewer and reporter from the public', async () => {
    const result = await getLostFound(report.id);
    expect(result).not.toHaveProperty('verificationNotes');
    expect(result).not.toHaveProperty('verifiedBy');
    expect(result).not.toHaveProperty('verifiedById');
    expect(result).not.toHaveProperty('reporterId');
    expect(result.verified).toBe(true);
  });

  it('shows them to the reporter', async () => {
    const result = await getLostFound(report.id, { userId: 'reporter-1', role: Role.STUDENT });
    expect(result).toMatchObject({ verificationNotes: report.verificationNotes, reporterId: 'reporter-1' });
  });
});
