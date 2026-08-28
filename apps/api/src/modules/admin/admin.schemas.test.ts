import { AssignmentStatus, BookingStatus, BusStatus, IncidentStatus, NotificationType, TripStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  adminListQuerySchema,
  createAdminBookingSchema,
  createAssignmentSchema,
  createAdminNotificationSchema,
  createBusSchema,
  createTripSchema,
  createUserSchema,
  incidentQuerySchema,
  updateIncidentSchema,
} from './admin.schemas.js';

describe('admin compatibility schemas', () => {
  it('normalizes lower-case UI enums and limit pagination', () => {
    expect(createBusSchema.parse({
      fleetNumber: 'BUS-8',
      registrationNumber: 'DHAKA-8',
      model: 'Campus Shuttle',
      capacity: 30,
      status: 'maintenance',
      gpsDeviceId: null,
      notes: null,
    }).status).toBe(BusStatus.UNDER_MAINTENANCE);
    expect(adminListQuerySchema.parse({ page: '2', limit: '50' })).toMatchObject({ page: 2, limit: 50 });
  });

  it('accepts the admin booking form payload and supplies an audit reason', () => {
    const parsed = createAdminBookingSchema.parse({
      studentId: '11111111-1111-4111-8111-111111111111',
      tripId: '22222222-2222-4222-8222-222222222222',
      seatNumber: '12A',
      status: 'pending',
      adminNote: null,
    });
    expect(parsed.status).toBe(BookingStatus.PENDING_PAYMENT);
    expect(parsed.adminNote).toBe('Created by an administrator');
  });

  it('accepts irrelevant null targeting fields from the notification form', () => {
    const parsed = createAdminNotificationSchema.parse({
      type: 'announcement',
      audience: 'all_students',
      routeId: null,
      tripId: null,
      title: 'Campus service update',
      message: 'The evening service will use the east gate.',
      sendPush: false,
    });
    expect(parsed.type).toBe(NotificationType.SYSTEM);
    expect(parsed.routeId).toBeUndefined();
    expect(parsed.tripId).toBeUndefined();
  });

  it('normalizes trip status and validates the schedule window', () => {
    const base = {
      routeId: '11111111-1111-4111-8111-111111111111',
      busId: '22222222-2222-4222-8222-222222222222',
      driverId: '33333333-3333-4333-8333-333333333333',
      scheduledStart: '2026-08-23T08:00:00.000Z',
      scheduledEnd: '2026-08-23T09:00:00.000Z',
      fare: 50,
      status: 'scheduled',
      notes: null,
    };
    expect(createTripSchema.parse(base).status).toBe(TripStatus.SCHEDULED);
    expect(() => createTripSchema.parse({ ...base, scheduledEnd: base.scheduledStart })).toThrow();
  });

  it('normalizes assignment status and rejects an invalid operating window', () => {
    const assignment = {
      driverId: '11111111-1111-4111-8111-111111111111',
      busId: '22222222-2222-4222-8222-222222222222',
      routeId: '33333333-3333-4333-8333-333333333333',
      startsAt: '2026-08-26T08:00:00.000Z',
      endsAt: '2026-08-26T18:00:00.000Z',
      status: 'active',
    };
    expect(createAssignmentSchema.parse(assignment).status).toBe(AssignmentStatus.ACTIVE);
    expect(() => createAssignmentSchema.parse({ ...assignment, endsAt: assignment.startsAt })).toThrow();
  });

  it('requires regulatory fields for new driver accounts', () => {
    expect(() => createUserSchema.parse({
      name: 'Driver Example',
      email: 'driver@example.edu',
      phone: '+8801000000000',
      role: 'driver',
      identifier: 'DRV-100',
      status: 'active',
      temporaryPassword: 'temporary-password',
    })).toThrow();
  });

  it('requires strong temporary passwords for administrator-created accounts', () => {
    const account = {
      name: 'Student Example',
      email: 'new-student@example.edu',
      phone: '+8801000000000',
      role: 'student',
      identifier: 'STU-100',
      status: 'active',
    };
    expect(() => createUserSchema.parse({ ...account, temporaryPassword: 'alllowercase12' })).toThrow();
    expect(createUserSchema.parse({ ...account, temporaryPassword: 'Temporary123' }).temporaryPassword).toBe('Temporary123');
    expect(createUserSchema.parse({ ...account, phone: '', temporaryPassword: 'Temporary123' }).phone).toBeUndefined();
    expect(() => createUserSchema.parse({ ...account, phone: '123', temporaryPassword: 'Temporary123' })).toThrow();
  });

  it('normalizes incident filters and requires notes when an incident is closed', () => {
    expect(incidentQuerySchema.parse({ status: 'acknowledged', severity: 'critical' }).status)
      .toBe(IncidentStatus.ACKNOWLEDGED);
    expect(updateIncidentSchema.parse({ status: 'acknowledged' })).toEqual({
      status: IncidentStatus.ACKNOWLEDGED,
    });
    expect(() => updateIncidentSchema.parse({ status: 'resolved' })).toThrow();
    expect(updateIncidentSchema.parse({ status: 'resolved', resolutionNotes: 'Driver and passengers are safe.' }).status)
      .toBe(IncidentStatus.RESOLVED);
    expect(() => updateIncidentSchema.parse({ status: 'open' })).toThrow();
  });
});
