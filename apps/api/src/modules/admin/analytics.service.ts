import {
  AlertSeverity,
  BookingStatus,
  BusStatus,
  CheckInResult,
  ClaimStatus,
  IncidentStatus,
  MaintenanceStatus,
  PaymentStatus,
  Prisma,
  RoadAlertStatus,
  SeatAllocationStatus,
  TripStatus,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

const DAY_MS = 86_400_000;
const DEFAULT_CURRENCY = 'BDT';
const ON_TIME_THRESHOLD_MINUTES = 5;
const MAX_ATTENTION_ITEMS = 8;

const ADMIN_OVERVIEW_RANGES = ['today', '7d', '30d'] as const;
const ADMIN_REPORT_RANGES = ['7d', '30d', '90d', '12m'] as const;

export type AdminOverviewRange = (typeof ADMIN_OVERVIEW_RANGES)[number];
export type AdminReportRange = (typeof ADMIN_REPORT_RANGES)[number];

export interface AdminOverviewMetrics {
  activeBuses: number;
  tripsToday: number;
  completedTrips: number;
  passengersToday: number;
  checkinsToday: number;
  revenueToday: number;
  failedPayments: number;
  busesInMaintenance: number;
  inactiveBuses: number;
}

export interface AdminOverviewChanges {
  activeBuses: number;
  trips: number;
  passengers: number;
  revenue: number;
}

export interface AdminFleetSummary {
  active: number;
  maintenance: number;
  inactive: number;
  retired: number;
  total: number;
}

export interface AdminAttentionItem {
  id: string;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  section: string;
}

export interface AdminActivityItem {
  id: string;
  title: string;
  description: string;
  section: string;
  createdAt: Date;
}

export interface AdminOverview {
  range: AdminOverviewRange;
  currency: string;
  metrics: AdminOverviewMetrics;
  changes: AdminOverviewChanges;
  fleet: AdminFleetSummary;
  attentionRequired: AdminAttentionItem[];
  recentActivity: AdminActivityItem[];
}

export interface AdminChartItem {
  label: string;
  value: number;
}

export interface AdminRouteUtilizationItem extends AdminChartItem {
  routeId: string;
  bookedSeats: number;
  availableSeats: number;
}

export interface AdminOnTimePerformanceItem extends AdminChartItem {
  routeId: string;
  onTimeTrips: number;
  measuredTrips: number;
}

export interface AdminReportSummary {
  revenue: number;
  seatUtilization: number;
  onTimeRate: number;
  averageRating: number;
}

export interface AdminReports {
  range: AdminReportRange;
  currency: string;
  summary: AdminReportSummary;
  revenueTrend: AdminChartItem[];
  routeUtilization: AdminRouteUtilizationItem[];
  onTimePerformance: AdminOnTimePerformanceItem[];
}

interface DateWindow {
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
}

interface ReportWindow extends DateWindow {
  bucket: 'day' | 'month';
  bucketCount: number;
}

type DatabaseNumber = Prisma.Decimal | bigint | number | string | null;

interface RevenueTrendRow {
  bucketKey: string;
  amount: DatabaseNumber;
}

interface RouteUtilizationRow {
  routeId: string;
  label: string;
  bookedSeats: DatabaseNumber;
  availableSeats: DatabaseNumber;
}

interface OnTimePerformanceRow {
  routeId: string;
  label: string;
  onTimeTrips: DatabaseNumber;
  measuredTrips: DatabaseNumber;
}

interface BusStatusCountRow {
  status: BusStatus;
  count: DatabaseNumber;
}

interface TripStatusCountRow {
  status: TripStatus;
  count: DatabaseNumber;
}

interface PendingAttentionItem extends AdminAttentionItem {
  occurredAt: Date;
  priority: number;
}

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const addUtcDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);

const reportWindow = (range: AdminReportRange, now: Date): ReportWindow => {
  const today = startOfUtcDay(now);

  if (range === '12m') {
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
    const previousStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 12, 1));
    return { start, end, previousStart, previousEnd: start, bucket: 'month', bucketCount: 12 };
  }

  const bucketCount = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const end = addUtcDays(today, 1);
  const start = addUtcDays(end, -bucketCount);
  const previousStart = addUtcDays(start, -bucketCount);
  return { start, end, previousStart, previousEnd: start, bucket: 'day', bucketCount };
};

const overviewWindow = (range: AdminOverviewRange, now: Date): DateWindow => {
  const today = startOfUtcDay(now);
  const days = range === 'today' ? 1 : range === '7d' ? 7 : 30;
  const end = addUtcDays(today, 1);
  const start = addUtcDays(end, -days);
  return {
    start,
    end,
    previousStart: addUtcDays(start, -days),
    previousEnd: start,
  };
};

const finiteNumber = (value: DatabaseNumber | undefined): number => {
  if (value === null || value === undefined) return 0;
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : 0;
};

const rounded = (value: number, digits = 1): number => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const percentage = (numerator: number, denominator: number): number => {
  if (denominator <= 0) return 0;
  return rounded(Math.min(100, Math.max(0, (numerator / denominator) * 100)));
};

const percentageChange = (current: number, previous: number): number => {
  if (current === 0 && previous === 0) return 0;
  if (previous === 0) return 100;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  return rounded(Math.min(999.9, Math.max(-999.9, change)));
};

const countTripGroups = (groups: TripStatusCountRow[]): number =>
  groups.reduce((total, group) => total + finiteNumber(group.count), 0);

const countTripStatus = (
  groups: TripStatusCountRow[],
  status: TripStatus,
): number => finiteNumber(groups.find((group) => group.status === status)?.count);

const parseOverviewRange = (range: string | undefined): AdminOverviewRange => {
  if (range && ADMIN_OVERVIEW_RANGES.includes(range as AdminOverviewRange)) return range as AdminOverviewRange;
  return 'today';
};

const parseReportRange = (range: string | undefined): AdminReportRange => {
  if (range && ADMIN_REPORT_RANGES.includes(range as AdminReportRange)) return range as AdminReportRange;
  return '30d';
};

const attentionSeverity = (severity: AlertSeverity): PendingAttentionItem['severity'] => {
  if (severity === AlertSeverity.CRITICAL || severity === AlertSeverity.MAJOR) return 'critical';
  if (severity === AlertSeverity.MODERATE || severity === AlertSeverity.MINOR) return 'warning';
  return 'info';
};

const attentionPriority = (severity: AlertSeverity): number => {
  if (severity === AlertSeverity.CRITICAL) return 50;
  if (severity === AlertSeverity.MAJOR) return 40;
  if (severity === AlertSeverity.MODERATE) return 30;
  if (severity === AlertSeverity.MINOR) return 20;
  return 10;
};

const utcTimestamp = (date: Date | null): string => {
  if (!date) return 'Return time is not yet available.';
  return `Expected back ${date.toISOString().replace('T', ' ').slice(0, 16)} UTC.`;
};

const sectionForEntity = (entityType: string): string => {
  const sections: Record<string, string> = {
    Bus: 'buses',
    Route: 'routes',
    Stop: 'stops',
    RouteStop: 'stops',
    Trip: 'trips',
    DriverAssignment: 'trips',
    User: 'users',
    StudentProfile: 'users',
    DriverProfile: 'users',
    Booking: 'bookings',
    SeatAllocation: 'bookings',
    Payment: 'payments',
    PaymentTransaction: 'payments',
    CheckIn: 'checkins',
    BookingQrCode: 'checkins',
    MaintenanceRecord: 'maintenance',
    RoadAlert: 'road-alerts',
    LostFoundReport: 'lost-found',
    LostFoundClaim: 'lost-found',
    LostFoundMatch: 'lost-found',
    DriverRating: 'ratings',
    Notification: 'notifications',
    DriverIncident: 'incidents',
  };
  return sections[entityType] ?? 'overview';
};

const activityTitle = (action: string): string => {
  const [subject = 'System', verb = 'updated'] = action.split('.');
  const readableSubject = subject
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());
  const verbs: Record<string, string> = {
    create: 'created',
    update: 'updated',
    delete: 'deleted',
    cancel: 'cancelled',
    refund: 'refunded',
    review: 'reviewed',
    moderate: 'moderated',
    revoke: 'revoked',
  };
  return `${readableSubject} ${verbs[verb] ?? verb}`;
};

const revenueTrendSql = (window: ReportWindow): Prisma.Sql => {
  if (window.bucket === 'month') {
    return Prisma.sql`
      SELECT
        to_char(p."paidAt" AT TIME ZONE 'UTC', 'YYYY-MM') AS "bucketKey",
        COALESCE(SUM(p."amount"), 0) AS "amount"
      FROM "payments" p
      WHERE p."status" = ${PaymentStatus.SUCCEEDED}::"PaymentStatus"
        AND p."currency" = ${DEFAULT_CURRENCY}
        AND p."paidAt" >= ${window.start}
        AND p."paidAt" < ${window.end}
      GROUP BY 1
      ORDER BY 1
    `;
  }

  return Prisma.sql`
    SELECT
      to_char(p."paidAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "bucketKey",
      COALESCE(SUM(p."amount"), 0) AS "amount"
    FROM "payments" p
    WHERE p."status" = ${PaymentStatus.SUCCEEDED}::"PaymentStatus"
      AND p."currency" = ${DEFAULT_CURRENCY}
      AND p."paidAt" >= ${window.start}
      AND p."paidAt" < ${window.end}
    GROUP BY 1
    ORDER BY 1
  `;
};

const routeUtilizationSql = (window: ReportWindow): Prisma.Sql => Prisma.sql`
  WITH "tripCapacity" AS (
    SELECT
      t."id" AS "tripId",
      t."routeId",
      b."capacity"::bigint AS "availableSeats"
    FROM "trips" t
    INNER JOIN "buses" b ON b."id" = t."busId"
    WHERE t."scheduledStartAt" >= ${window.start}
      AND t."scheduledStartAt" < ${window.end}
      AND t."status" <> ${TripStatus.CANCELLED}::"TripStatus"
  ),
  "tripBookings" AS (
    SELECT sa."tripId", COUNT(*)::bigint AS "bookedSeats"
    FROM "seat_allocations" sa
    INNER JOIN "tripCapacity" tc ON tc."tripId" = sa."tripId"
    WHERE sa."status" IN (
      ${SeatAllocationStatus.CONFIRMED}::"SeatAllocationStatus",
      ${SeatAllocationStatus.CHECKED_IN}::"SeatAllocationStatus"
    )
    GROUP BY sa."tripId"
  )
  SELECT
    r."id"::text AS "routeId",
    CONCAT(r."code", ' · ', r."name") AS "label",
    COALESCE(SUM(tb."bookedSeats"), 0) AS "bookedSeats",
    COALESCE(SUM(tc."availableSeats"), 0) AS "availableSeats"
  FROM "tripCapacity" tc
  INNER JOIN "routes" r ON r."id" = tc."routeId"
  LEFT JOIN "tripBookings" tb ON tb."tripId" = tc."tripId"
  GROUP BY r."id", r."code", r."name"
  HAVING SUM(tc."availableSeats") > 0
  ORDER BY
    (COALESCE(SUM(tb."bookedSeats"), 0)::numeric / NULLIF(SUM(tc."availableSeats"), 0)) DESC,
    r."name" ASC
`;

const onTimePerformanceSql = (window: ReportWindow): Prisma.Sql => Prisma.sql`
  SELECT
    r."id"::text AS "routeId",
    CONCAT(r."code", ' · ', r."name") AS "label",
    COUNT(*) FILTER (
      WHERE t."actualStartAt" <=
        t."scheduledStartAt" + make_interval(mins => ${ON_TIME_THRESHOLD_MINUTES})
    )::bigint AS "onTimeTrips",
    COUNT(*)::bigint AS "measuredTrips"
  FROM "trips" t
  INNER JOIN "routes" r ON r."id" = t."routeId"
  WHERE t."scheduledStartAt" >= ${window.start}
    AND t."scheduledStartAt" < ${window.end}
    AND t."status" = ${TripStatus.COMPLETED}::"TripStatus"
    AND t."actualStartAt" IS NOT NULL
  GROUP BY r."id", r."code", r."name"
  ORDER BY
    (COUNT(*) FILTER (
      WHERE t."actualStartAt" <=
        t."scheduledStartAt" + make_interval(mins => ${ON_TIME_THRESHOLD_MINUTES})
    )::numeric / NULLIF(COUNT(*), 0)) DESC,
    r."name" ASC
`;

const bucketKey = (date: Date, bucket: ReportWindow['bucket']): string => {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  if (bucket === 'month') return `${year}-${month}`;
  return `${year}-${month}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

const bucketLabel = (date: Date, bucket: ReportWindow['bucket']): string => {
  if (bucket === 'month') {
    return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
  }
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
};

const fillRevenueBuckets = (window: ReportWindow, rows: RevenueTrendRow[]): AdminChartItem[] => {
  const values = new Map(rows.map((row) => [row.bucketKey, finiteNumber(row.amount)]));
  return Array.from({ length: window.bucketCount }, (_, index) => {
    const date =
      window.bucket === 'month'
        ? new Date(Date.UTC(window.start.getUTCFullYear(), window.start.getUTCMonth() + index, 1))
        : addUtcDays(window.start, index);
    return {
      label: bucketLabel(date, window.bucket),
      value: rounded(values.get(bucketKey(date, window.bucket)) ?? 0, 2),
    };
  });
};

export const getAdminOverview = async (requestedRange?: string): Promise<AdminOverview> => {
  const range = parseOverviewRange(requestedRange);
  const now = new Date();
  const window = overviewWindow(range, now);
  const passengerStatuses = [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.COMPLETED];

  const [
    fleetGroups,
    currentTripGroups,
    previousTripGroups,
    currentPassengers,
    previousPassengers,
    currentCheckins,
    currentRevenue,
    previousRevenue,
    failedPayments,
    maintenanceRecords,
    roadAlerts,
    incidents,
    disruptedTrips,
    pendingClaims,
    auditLogs,
  ] = await prisma.$transaction([
    prisma.$queryRaw<BusStatusCountRow[]>(Prisma.sql`
      SELECT b."status"::text AS "status", COUNT(*)::bigint AS "count"
      FROM "buses" b
      GROUP BY b."status"
      ORDER BY b."status"
    `),
    prisma.$queryRaw<TripStatusCountRow[]>(Prisma.sql`
      SELECT t."status"::text AS "status", COUNT(*)::bigint AS "count"
      FROM "trips" t
      WHERE t."scheduledStartAt" >= ${window.start}
        AND t."scheduledStartAt" < ${window.end}
      GROUP BY t."status"
      ORDER BY t."status"
    `),
    prisma.$queryRaw<TripStatusCountRow[]>(Prisma.sql`
      SELECT t."status"::text AS "status", COUNT(*)::bigint AS "count"
      FROM "trips" t
      WHERE t."scheduledStartAt" >= ${window.previousStart}
        AND t."scheduledStartAt" < ${window.previousEnd}
      GROUP BY t."status"
      ORDER BY t."status"
    `),
    prisma.booking.count({
      where: {
        status: { in: passengerStatuses },
        trip: { scheduledStartAt: { gte: window.start, lt: window.end } },
      },
    }),
    prisma.booking.count({
      where: {
        status: { in: passengerStatuses },
        trip: { scheduledStartAt: { gte: window.previousStart, lt: window.previousEnd } },
      },
    }),
    prisma.checkIn.count({
      where: {
        result: CheckInResult.ACCEPTED,
        checkedInAt: { gte: window.start, lt: window.end },
      },
    }),
    prisma.payment.aggregate({
      where: {
        status: PaymentStatus.SUCCEEDED,
        currency: DEFAULT_CURRENCY,
        paidAt: { gte: window.start, lt: window.end },
      },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: {
        status: PaymentStatus.SUCCEEDED,
        currency: DEFAULT_CURRENCY,
        paidAt: { gte: window.previousStart, lt: window.previousEnd },
      },
      _sum: { amount: true },
    }),
    prisma.payment.count({
      where: { status: PaymentStatus.FAILED, failedAt: { gte: window.start, lt: window.end } },
    }),
    prisma.maintenanceRecord.findMany({
      where: {
        status: { in: [MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS] },
        startsAt: { lte: addUtcDays(now, 7) },
        OR: [{ expectedReturnAt: null }, { expectedReturnAt: { gte: now } }],
      },
      select: {
        id: true,
        title: true,
        status: true,
        startsAt: true,
        expectedReturnAt: true,
        bus: { select: { fleetNumber: true } },
      },
      orderBy: [{ status: 'desc' }, { startsAt: 'asc' }],
      take: 6,
    }),
    prisma.roadAlert.findMany({
      where: {
        status: RoadAlertStatus.ACTIVE,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
      select: {
        id: true,
        title: true,
        description: true,
        severity: true,
        createdAt: true,
        routes: { select: { route: { select: { code: true } } } },
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 6,
    }),
    prisma.driverIncident.findMany({
      where: { status: { in: [IncidentStatus.OPEN, IncidentStatus.ACKNOWLEDGED] } },
      select: {
        id: true,
        incidentNumber: true,
        title: true,
        severity: true,
        occurredAt: true,
        trip: { select: { publicCode: true } },
      },
      orderBy: [{ severity: 'desc' }, { occurredAt: 'desc' }],
      take: 6,
    }),
    prisma.trip.findMany({
      where: {
        status: { in: [TripStatus.DELAYED, TripStatus.CANCELLED] },
        scheduledStartAt: { gte: window.start, lt: window.end },
      },
      select: {
        id: true,
        publicCode: true,
        status: true,
        delayMinutes: true,
        delayReason: true,
        cancellationReason: true,
        scheduledStartAt: true,
        route: { select: { name: true } },
      },
      orderBy: [{ status: 'desc' }, { scheduledStartAt: 'desc' }],
      take: 6,
    }),
    prisma.lostFoundClaim.count({ where: { status: ClaimStatus.PENDING } }),
    prisma.auditLog.findMany({
      select: {
        id: true,
        action: true,
        entityType: true,
        createdAt: true,
        actor: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

  const fleetCount = (status: BusStatus): number =>
    finiteNumber(fleetGroups.find((group) => group.status === status)?.count);
  const activeBuses = fleetCount(BusStatus.ACTIVE);
  const busesInMaintenance = fleetCount(BusStatus.UNDER_MAINTENANCE);
  const retiredBuses = fleetCount(BusStatus.RETIRED);
  const inactiveBuses = fleetCount(BusStatus.INACTIVE) + retiredBuses;
  const trips = countTripGroups(currentTripGroups);
  const previousTrips = countTripGroups(previousTripGroups);
  const revenue = finiteNumber(currentRevenue._sum.amount);
  const priorRevenue = finiteNumber(previousRevenue._sum.amount);

  const attention: PendingAttentionItem[] = [
    ...incidents.map((incident) => ({
      id: `incident-${incident.id}`,
      title: incident.title,
      description: `${incident.incidentNumber}${incident.trip ? ` · Trip ${incident.trip.publicCode}` : ''}`,
      severity: attentionSeverity(incident.severity),
      section: 'incidents',
      occurredAt: incident.occurredAt,
      priority: attentionPriority(incident.severity) + 5,
    })),
    ...roadAlerts.map((alert) => {
      const routeCodes = alert.routes.map(({ route }) => route.code).join(', ');
      return {
        id: `road-alert-${alert.id}`,
        title: alert.title,
        description: routeCodes ? `${alert.description} · Routes: ${routeCodes}` : alert.description,
        severity: attentionSeverity(alert.severity),
        section: 'road-alerts',
        occurredAt: alert.createdAt,
        priority: attentionPriority(alert.severity),
      };
    }),
    ...disruptedTrips.map((trip) => {
      const cancelled = trip.status === TripStatus.CANCELLED;
      const detail = cancelled
        ? trip.cancellationReason ?? 'The trip was cancelled without a recorded reason.'
        : `${trip.delayMinutes} minute delay${trip.delayReason ? ` · ${trip.delayReason}` : ''}`;
      return {
        id: `trip-${trip.id}`,
        title: `${trip.publicCode} · ${trip.route.name}`,
        description: detail,
        severity: cancelled ? ('critical' as const) : ('warning' as const),
        section: 'trips',
        occurredAt: trip.scheduledStartAt,
        priority: cancelled ? 42 : 32,
      };
    }),
    ...maintenanceRecords.map((record) => ({
      id: `maintenance-${record.id}`,
      title: `${record.bus.fleetNumber} · ${record.title}`,
      description: utcTimestamp(record.expectedReturnAt),
      severity: record.status === MaintenanceStatus.IN_PROGRESS ? ('warning' as const) : ('info' as const),
      section: 'maintenance',
      occurredAt: record.startsAt,
      priority: record.status === MaintenanceStatus.IN_PROGRESS ? 28 : 12,
    })),
  ];

  if (failedPayments > 0) {
    attention.push({
      id: 'failed-payments',
      title: `${failedPayments} failed payment${failedPayments === 1 ? '' : 's'}`,
      description: 'Review recent gateway failures and retry eligibility.',
      severity: 'warning',
      section: 'payments',
      occurredAt: now,
      priority: 26,
    });
  }

  if (pendingClaims > 0) {
    attention.push({
      id: 'pending-lost-found-claims',
      title: `${pendingClaims} lost-and-found claim${pendingClaims === 1 ? '' : 's'} awaiting review`,
      description: 'Verify ownership evidence before approving a handover.',
      severity: 'info',
      section: 'lost-found',
      occurredAt: now,
      priority: 14,
    });
  }

  attention.sort((left, right) => right.priority - left.priority || right.occurredAt.getTime() - left.occurredAt.getTime());

  return {
    range,
    currency: DEFAULT_CURRENCY,
    metrics: {
      activeBuses,
      tripsToday: trips,
      completedTrips: countTripStatus(currentTripGroups, TripStatus.COMPLETED),
      passengersToday: currentPassengers,
      checkinsToday: currentCheckins,
      revenueToday: rounded(revenue, 2),
      failedPayments,
      busesInMaintenance,
      inactiveBuses,
    },
    changes: {
      // Bus status history is not stored, so reporting a fabricated period-over-period value would be misleading.
      activeBuses: 0,
      trips: percentageChange(trips, previousTrips),
      passengers: percentageChange(currentPassengers, previousPassengers),
      revenue: percentageChange(revenue, priorRevenue),
    },
    fleet: {
      active: activeBuses,
      maintenance: busesInMaintenance,
      inactive: inactiveBuses,
      retired: retiredBuses,
      total: fleetGroups.reduce((total, group) => total + finiteNumber(group.count), 0),
    },
    attentionRequired: attention.slice(0, MAX_ATTENTION_ITEMS).map(({ occurredAt: _occurredAt, priority: _priority, ...item }) => item),
    recentActivity: auditLogs.map((activity) => ({
      id: activity.id.toString(),
      title: activityTitle(activity.action),
      description: `${activity.actor?.name ?? 'System'} · ${activity.entityType}`,
      section: sectionForEntity(activity.entityType),
      createdAt: activity.createdAt,
    })),
  };
};

export const getAdminReports = async (requestedRange?: string): Promise<AdminReports> => {
  const range = parseReportRange(requestedRange);
  const window = reportWindow(range, new Date());

  const [revenueRows, utilizationRows, onTimeRows, rating] = await prisma.$transaction([
    prisma.$queryRaw<RevenueTrendRow[]>(revenueTrendSql(window)),
    prisma.$queryRaw<RouteUtilizationRow[]>(routeUtilizationSql(window)),
    prisma.$queryRaw<OnTimePerformanceRow[]>(onTimePerformanceSql(window)),
    prisma.driverRating.aggregate({
      where: { isVisible: true, createdAt: { gte: window.start, lt: window.end } },
      _avg: { score: true },
    }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

  const revenueTrend = fillRevenueBuckets(window, revenueRows);
  const routeUtilization = utilizationRows.map((row) => {
    const bookedSeats = finiteNumber(row.bookedSeats);
    const availableSeats = finiteNumber(row.availableSeats);
    return {
      routeId: row.routeId,
      label: row.label,
      value: percentage(bookedSeats, availableSeats),
      bookedSeats,
      availableSeats,
    };
  });
  const onTimePerformance = onTimeRows.map((row) => {
    const onTimeTrips = finiteNumber(row.onTimeTrips);
    const measuredTrips = finiteNumber(row.measuredTrips);
    return {
      routeId: row.routeId,
      label: row.label,
      value: percentage(onTimeTrips, measuredTrips),
      onTimeTrips,
      measuredTrips,
    };
  });

  const totalBookedSeats = routeUtilization.reduce((total, item) => total + item.bookedSeats, 0);
  const totalAvailableSeats = routeUtilization.reduce((total, item) => total + item.availableSeats, 0);
  const totalOnTimeTrips = onTimePerformance.reduce((total, item) => total + item.onTimeTrips, 0);
  const totalMeasuredTrips = onTimePerformance.reduce((total, item) => total + item.measuredTrips, 0);

  return {
    range,
    currency: DEFAULT_CURRENCY,
    summary: {
      revenue: rounded(revenueTrend.reduce((total, item) => total + item.value, 0), 2),
      seatUtilization: percentage(totalBookedSeats, totalAvailableSeats),
      onTimeRate: percentage(totalOnTimeTrips, totalMeasuredTrips),
      averageRating: rounded(rating._avg.score ?? 0),
    },
    revenueTrend,
    routeUtilization,
    onTimePerformance,
  };
};
