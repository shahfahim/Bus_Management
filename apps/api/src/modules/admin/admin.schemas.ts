import {
  AssignmentStatus,
  BookingStatus,
  BusStatus,
  CheckInResult,
  DriverStatus,
  IncidentCategory,
  IncidentStatus,
  AlertSeverity,
  NotificationType,
  Role,
  RouteStatus,
  TripStatus,
  UserStatus,
} from '@prisma/client';
import { z } from 'zod';
import { strongPassword } from '../../lib/password-policy.js';

const normalizeEnum = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase().replaceAll('-', '_').replaceAll(' ', '_') : value;

export const enumValue = <T extends z.EnumLike>(values: T, aliases: Record<string, string> = {}) =>
  z.preprocess((value) => {
    if (value === null || value === '') return undefined;
    const normalized = normalizeEnum(value);
    return typeof normalized === 'string' ? aliases[normalized] ?? normalized : normalized;
  }, z.nativeEnum(values));

const optionalText = (max: number) =>
  z.preprocess((value) => (value === null || value === '' ? undefined : value), z.string().trim().max(max).optional());
const optionalDate = z.preprocess(
  (value) => (value === null || value === '' ? undefined : value),
  z.coerce.date().optional(),
);
const nullableText = (max: number) =>
  z.preprocess((value) => (value === '' ? null : value), z.string().trim().max(max).nullable().optional());
const nullableDate = z.preprocess(
  (value) => (value === '' ? null : value),
  z.coerce.date().nullable().optional(),
);
const optionalUuid = z.preprocess(
  (value) => (value === null || value === '' ? undefined : value),
  z.string().uuid().optional(),
);
const adminNote = (fallback: string) =>
  z.preprocess(
    (value) => (value === null || value === '' ? undefined : value),
    z.string().trim().min(3).max(1_000).default(fallback),
  );

export const idSchema = z.string().uuid();

export const adminListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  search: optionalText(100),
  sort: optionalText(64),
  order: z.preprocess((value) => (typeof value === 'string' ? value.toLowerCase() : value), z.enum(['asc', 'desc']).default('desc')),
});

export const busQuerySchema = adminListQuerySchema.extend({
  status: enumValue(BusStatus, { MAINTENANCE: BusStatus.UNDER_MAINTENANCE }).optional(),
});

export const createBusSchema = z.object({
  fleetNumber: z.string().trim().min(2).max(32),
  registrationNumber: z.string().trim().min(3).max(64),
  make: optionalText(80),
  model: z.string().trim().min(1).max(80),
  modelYear: z.coerce.number().int().min(1950).max(new Date().getUTCFullYear() + 2).optional(),
  capacity: z.coerce.number().int().min(1).max(120),
  status: enumValue(BusStatus, { MAINTENANCE: BusStatus.UNDER_MAINTENANCE }).default(BusStatus.ACTIVE),
  gpsDeviceId: optionalText(128),
  trackingDeviceId: optionalText(128),
  notes: optionalText(5_000),
});

export const updateBusSchema = createBusSchema.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const routeQuerySchema = adminListQuerySchema.extend({ status: enumValue(RouteStatus).optional() });

export const createRouteSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(2).max(160),
  origin: optionalText(160),
  destination: optionalText(160),
  distanceKm: z.coerce.number().positive().max(50_000),
  estimatedDurationMinutes: z.coerce.number().int().positive().max(10_080),
  status: enumValue(RouteStatus).default(RouteStatus.ACTIVE),
  description: optionalText(5_000),
  stopIds: z.array(idSchema).optional(),
});

export const updateRouteSchema = z
  .object({
    code: z.string().trim().min(1).max(32).optional(),
    name: z.string().trim().min(2).max(160).optional(),
    origin: nullableText(160),
    destination: nullableText(160),
    distanceKm: z.coerce.number().positive().max(50_000).optional(),
    estimatedDurationMinutes: z.coerce.number().int().positive().max(10_080).optional(),
    status: enumValue(RouteStatus).optional(),
    description: nullableText(5_000),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const stopQuerySchema = adminListQuerySchema.extend({
  routeId: idSchema.optional(),
  status: z.preprocess(
    (value) => (typeof value === 'string' ? value.toLowerCase() : value),
    z.enum(['active', 'inactive']).optional(),
  ),
});

export const createStopSchema = z.object({
  routeId: idSchema,
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(2).max(160),
  sequence: z.coerce.number().int().positive(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  status: z.preprocess(
    (value) => (typeof value === 'string' ? value.toLowerCase() : value),
    z.enum(['active', 'inactive']).default('active'),
  ),
  landmark: optionalText(1_000),
});

export const updateStopSchema = z
  .object({
    routeId: idSchema.optional(),
    code: z.string().trim().min(1).max(32).optional(),
    name: z.string().trim().min(2).max(160).optional(),
    sequence: z.coerce.number().int().positive().optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    status: z.preprocess(
      (value) => (typeof value === 'string' ? value.toLowerCase() : value),
      z.enum(['active', 'inactive']).optional(),
    ),
    landmark: nullableText(1_000),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const tripQuerySchema = adminListQuerySchema.extend({
  status: enumValue(TripStatus).optional(),
  date: z.preprocess(
    (value) => (typeof value === 'string' ? value.toLowerCase() : value),
    z.enum(['today', 'next_7_days', 'past']).optional(),
  ),
  routeId: idSchema.optional(),
  busId: idSchema.optional(),
  driverId: idSchema.optional(),
});

export const assignmentQuerySchema = adminListQuerySchema.extend({
  status: enumValue(AssignmentStatus).optional(),
  driverId: idSchema.optional(),
  busId: idSchema.optional(),
});

export const createAssignmentSchema = z
  .object({
    driverId: idSchema,
    busId: idSchema,
    routeId: idSchema,
    startsAt: z.coerce.date(),
    endsAt: nullableDate,
    status: enumValue(AssignmentStatus).default(AssignmentStatus.SCHEDULED),
    notes: optionalText(2_000),
  })
  .refine((value) => !value.endsAt || value.endsAt > value.startsAt, {
    path: ['endsAt'],
    message: 'Assignment end must be after its start',
  });

export const updateAssignmentSchema = z
  .object({
    driverId: idSchema.optional(),
    busId: idSchema.optional(),
    routeId: idSchema.optional(),
    startsAt: optionalDate,
    endsAt: nullableDate,
    status: enumValue(AssignmentStatus).optional(),
    notes: nullableText(2_000),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const createTripSchema = z
  .object({
    routeId: idSchema,
    busId: idSchema,
    driverId: idSchema,
    conductorId: idSchema.optional(),
    scheduledStart: z.coerce.date(),
    scheduledEnd: z.coerce.date(),
    fare: z.coerce.number().nonnegative().max(100_000_000),
    status: enumValue(TripStatus).default(TripStatus.SCHEDULED),
    notes: optionalText(5_000),
  })
  .refine((value) => value.scheduledEnd > value.scheduledStart, {
    path: ['scheduledEnd'],
    message: 'Scheduled arrival must be after departure',
  });

export const updateTripSchema = z
  .object({
    routeId: idSchema.optional(),
    busId: idSchema.optional(),
    driverId: idSchema.optional(),
    conductorId: idSchema.nullable().optional(),
    scheduledStart: optionalDate,
    scheduledEnd: nullableDate,
    fare: z.coerce.number().nonnegative().max(100_000_000).optional(),
    status: enumValue(TripStatus).optional(),
    notes: nullableText(5_000),
    delayReason: nullableText(2_000),
    cancellationReason: nullableText(2_000),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const scheduleQuerySchema = adminListQuerySchema.extend({
  status: z.preprocess((value) => (typeof value === 'string' ? value.toLowerCase() : value), z.enum(['active', 'inactive']).optional()),
  routeId: idSchema.optional(),
});

const scheduleBaseSchema = z.object({
  routeId: idSchema,
  busId: idSchema,
  driverId: idSchema,
  departureTime: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, 'Must be in HH:mm format'),
  isActive: z.boolean().default(true),
  validFrom: z.coerce.date(),
  validTo: nullableDate,
  daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).min(1, 'Select at least one day'),
});

export const createScheduleSchema = scheduleBaseSchema
  .refine((data) => !data.validTo || data.validTo >= data.validFrom, 'validTo must be after validFrom');

export const updateScheduleSchema = scheduleBaseSchema.partial();


export const userQuerySchema = adminListQuerySchema.extend({
  role: enumValue(Role).optional(),
  status: enumValue(UserStatus, { INACTIVE: UserStatus.DEACTIVATED }).optional(),
});

export const createUserSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    email: z.string().trim().email().max(320),
    phone: z.preprocess(
      (value) => (value === null || value === '' ? undefined : value),
      z.string().trim().min(5).max(32).optional(),
    ),
    role: enumValue(Role),
    identifier: z.string().trim().min(1).max(64),
    status: enumValue(UserStatus, { INACTIVE: UserStatus.DEACTIVATED }).default(UserStatus.ACTIVE),
    temporaryPassword: strongPassword(12),
    licenseNumber: optionalText(96),
    licenseExpiresAt: optionalDate,
    avatarUrl: optionalText(500),
  })
  .superRefine((value, context) => {
    if (value.role === Role.DRIVER && (!value.licenseNumber || !value.licenseExpiresAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['licenseNumber'],
        message: 'Driver accounts require licenseNumber and licenseExpiresAt',
      });
    }
  });

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    email: z.string().trim().email().max(320).optional(),
    phone: nullableText(32),
    role: enumValue(Role).optional(),
    identifier: z.string().trim().min(1).max(64).optional(),
    status: enumValue(UserStatus, { INACTIVE: UserStatus.DEACTIVATED }).optional(),
    licenseNumber: z.string().trim().min(2).max(96).optional(),
    licenseExpiresAt: optionalDate,
    driverStatus: enumValue(DriverStatus).optional(),
    avatarUrl: nullableText(500),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

const bookingAliases = { PENDING: BookingStatus.PENDING_PAYMENT } as const;

export const bookingQuerySchema = adminListQuerySchema.extend({
  status: enumValue(BookingStatus, bookingAliases).optional(),
  tripId: idSchema.optional(),
  studentId: idSchema.optional(),
});

export const createAdminBookingSchema = z.object({
  studentId: idSchema,
  tripId: idSchema,
  seatNumber: z.string().trim().min(1).max(16),
  status: enumValue(BookingStatus, bookingAliases).default(BookingStatus.CONFIRMED),
  adminNote: adminNote('Created by an administrator'),
});

export const updateAdminBookingSchema = z
  .object({
    studentId: idSchema.optional(),
    tripId: idSchema.optional(),
    seatNumber: z.string().trim().min(1).max(16).optional(),
    status: enumValue(BookingStatus, bookingAliases).optional(),
    adminNote: adminNote('Updated by an administrator'),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const cancellationSchema = z.object({
  reason: z.string().trim().min(3).max(1_000).default('Cancelled by an administrator'),
});

export const paymentQuerySchema = adminListQuerySchema.extend({
  status: z.preprocess((value) => {
    const normalized = normalizeEnum(value);
    return normalized === 'SUCCESS' ? 'SUCCEEDED' : normalized;
  }, z.enum(['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED']).optional()),
});

export const refundSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const checkInQuerySchema = adminListQuerySchema.extend({
  status: z.preprocess((value) => (typeof value === 'string' ? value.toLowerCase() : value), z.enum(['valid', 'rejected', 'revoked']).optional()),
  tripId: idSchema.optional(),
});

export const createManualCheckInSchema = z.object({
  bookingId: idSchema,
  reason: z.string().trim().min(5).max(1_000),
});

export const ratingQuerySchema = adminListQuerySchema.extend({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  status: z.preprocess((value) => (typeof value === 'string' ? value.toLowerCase() : value), z.enum(['published', 'flagged', 'hidden']).optional()),
});

export const moderateAdminRatingSchema = z.object({
  status: z.preprocess((value) => (typeof value === 'string' ? value.toUpperCase() : value), z.enum(['PUBLISHED', 'HIDDEN', 'FLAGGED'])),
  reason: optionalText(1_000),
});

const notificationAliases: Record<string, NotificationType> = {
  ANNOUNCEMENT: NotificationType.SYSTEM,
  DELAY: NotificationType.TRIP_DELAYED,
  CANCELLATION: NotificationType.TRIP_CANCELLED,
  MAINTENANCE: NotificationType.BUS_MAINTENANCE,
};

export const notificationQuerySchema = adminListQuerySchema.extend({
  type: enumValue(NotificationType, notificationAliases).optional(),
  delivery: z.preprocess(
    (value) => (typeof value === 'string' ? value.toLowerCase() : value),
    z.enum(['delivered', 'partial', 'failed']).optional(),
  ),
});

export const createAdminNotificationSchema = z
  .object({
    type: enumValue(NotificationType, notificationAliases),
    audience: z.preprocess(
      (value) => (typeof value === 'string' ? value.toLowerCase() : value),
      z.enum(['all_students', 'all_drivers', 'route', 'trip']),
    ),
    routeId: optionalUuid,
    tripId: optionalUuid,
    title: z.string().trim().min(3).max(200),
    message: z.string().trim().min(3).max(500),
    sendPush: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (value.audience === 'route' && !value.routeId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['routeId'], message: 'A route is required for this audience' });
    }
    if (value.audience === 'trip' && !value.tripId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['tripId'], message: 'A trip is required for this audience' });
    }
  });

export const reportsRangeSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.toLowerCase() : value),
  z.enum(['7d', '30d', '90d', '12m']).default('30d'),
);

export const overviewRangeSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.toLowerCase() : value),
  z.enum(['today', '7d', '30d']).default('today'),
);

export const incidentQuerySchema = adminListQuerySchema.extend({
  status: enumValue(IncidentStatus).optional(),
  severity: enumValue(AlertSeverity).optional(),
  category: enumValue(IncidentCategory).optional(),
  driverId: idSchema.optional(),
  tripId: idSchema.optional(),
});

export const updateIncidentSchema = z
  .object({
    status: enumValue(IncidentStatus).refine(
      (status) => status !== IncidentStatus.OPEN,
      'An incident cannot be moved back to open',
    ),
    resolutionNotes: optionalText(5_000),
  })
  .superRefine((value, context) => {
    if (
      (value.status === IncidentStatus.RESOLVED || value.status === IncidentStatus.DISMISSED) &&
      !value.resolutionNotes
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resolutionNotes'],
        message: 'Resolution notes are required when closing an incident',
      });
    }
  });

export const checkInResultForFilter = (status: 'valid' | 'rejected' | 'revoked'): CheckInResult | { in: CheckInResult[] } => {
  if (status === 'valid') return CheckInResult.ACCEPTED;
  if (status === 'revoked') return CheckInResult.REJECTED_REVOKED;
  return {
    in: [
      CheckInResult.REJECTED_INVALID,
      CheckInResult.REJECTED_DUPLICATE,
      CheckInResult.REJECTED_EXPIRED,
      CheckInResult.REJECTED_WRONG_TRIP,
    ],
  };
};
