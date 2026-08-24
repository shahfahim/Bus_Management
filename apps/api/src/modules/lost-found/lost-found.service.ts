import { randomBytes } from 'node:crypto';
import {
  ClaimStatus,
  LostFoundReportType,
  LostFoundStatus,
  MatchStatus,
  NotificationType,
  Role,
  UserStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { paginated, toPagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import type { AuditContext } from '../admin/audit.service.js';
import { writeAuditLog } from '../admin/audit.service.js';
import { notifyUser, notifyUsers } from '../notifications/notification.service.js';
import type {
  createClaimSchema,
  createLostFoundSchema,
  lostFoundQuerySchema,
  reviewClaimSchema,
  reviewMatchSchema,
  updateLostFoundSchema,
} from './lost-found.schemas.js';
import { removeLostFoundUrls, type StoredLostFoundImage } from './lost-found.upload.js';

type LostFoundQuery = z.infer<typeof lostFoundQuerySchema>;
type CreateLostFoundInput = z.infer<typeof createLostFoundSchema>;
type UpdateLostFoundInput = z.infer<typeof updateLostFoundSchema>;
type CreateClaimInput = z.infer<typeof createClaimSchema>;
type ReviewClaimInput = z.infer<typeof reviewClaimSchema>;
type ReviewMatchInput = z.infer<typeof reviewMatchSchema>;

export const canTransitionLostFoundMatch = (current: MatchStatus, next: MatchStatus): boolean => {
  if (current === MatchStatus.SUGGESTED) {
    return ([MatchStatus.CONFIRMED, MatchStatus.REJECTED] as MatchStatus[]).includes(next);
  }
  if (current === MatchStatus.CONFIRMED) {
    return ([MatchStatus.RESOLVED, MatchStatus.REJECTED] as MatchStatus[]).includes(next);
  }
  return false;
};

const include = {
  reporter: { select: { id: true, name: true, avatarUrl: true } },
  verifiedBy: { select: { id: true, name: true } },
  images: { orderBy: { sortOrder: 'asc' as const } },
  _count: { select: { lostMatches: true, foundMatches: true, claims: true } },
} as const;

type ReportWithRelations = Prisma.LostFoundReportGetPayload<{ include: typeof include }>;

const dto = (report: ReportWithRelations, includeReporter = false) => {
  const { reporter, reporterId, ...publicReport } = report;
  return {
  ...publicReport,
  ...(includeReporter ? { reporter, reporterId } : {}),
  latitude: report.latitude === null ? null : Number(report.latitude),
  longitude: report.longitude === null ? null : Number(report.longitude),
  reference: report.reportNumber,
  location: report.locationText,
  occurredAt: report.happenedAt,
  imageUrl: report.images[0]?.url,
  verified: Boolean(report.verifiedAt),
  matchCount: report._count.lostMatches + report._count.foundMatches,
  claimCount: report._count.claims,
  };
};

const reportNumber = (): string =>
  `LNF-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(5).toString('hex').toUpperCase()}`;

const visibleStatuses = [
  LostFoundStatus.OPEN,
  LostFoundStatus.MATCHED,
  LostFoundStatus.CLAIM_PENDING,
  LostFoundStatus.CLAIMED,
  LostFoundStatus.RETURNED,
] as const;

const matchableReportStatuses: LostFoundStatus[] = [LostFoundStatus.OPEN, LostFoundStatus.MATCHED];
const terminalReportStatuses: LostFoundStatus[] = [
  LostFoundStatus.CLOSED,
  LostFoundStatus.REJECTED,
  LostFoundStatus.RETURNED,
];
const claimableReportStatuses: LostFoundStatus[] = [
  LostFoundStatus.OPEN,
  LostFoundStatus.MATCHED,
  LostFoundStatus.CLAIM_PENDING,
];

export const listLostFound = async (
  rawQuery: LostFoundQuery,
  actor?: { userId: string; role: Role },
  admin = false,
) => {
  const pageSize = rawQuery.pageSize ?? rawQuery.limit ?? 20;
  const query = { ...rawQuery, pageSize };
  const requestedStatuses = rawQuery.status;
  const where: Prisma.LostFoundReportWhereInput = {
    ...(rawQuery.type ? { type: rawQuery.type } : {}),
    ...(rawQuery.category ? { category: { equals: rawQuery.category, mode: 'insensitive' } } : {}),
    ...(rawQuery.reporterId ? { reporterId: rawQuery.reporterId } : {}),
    ...(requestedStatuses?.length ? { status: { in: requestedStatuses } } : {}),
    ...(rawQuery.from || rawQuery.to
      ? { happenedAt: { ...(rawQuery.from ? { gte: rawQuery.from } : {}), ...(rawQuery.to ? { lte: rawQuery.to } : {}) } }
      : {}),
    ...(rawQuery.search
      ? {
          OR: [
            { reportNumber: { contains: rawQuery.search, mode: 'insensitive' } },
            { title: { contains: rawQuery.search, mode: 'insensitive' } },
            { description: { contains: rawQuery.search, mode: 'insensitive' } },
            { category: { contains: rawQuery.search, mode: 'insensitive' } },
            { color: { contains: rawQuery.search, mode: 'insensitive' } },
            { brand: { contains: rawQuery.search, mode: 'insensitive' } },
            { locationText: { contains: rawQuery.search, mode: 'insensitive' } },
            ...(admin ? [{ reporter: { name: { contains: rawQuery.search, mode: 'insensitive' as const } } }] : []),
          ],
        }
      : {}),
    ...(!admin
      ? actor
        ? { AND: [{ OR: [{ status: { in: [...visibleStatuses] } }, { reporterId: actor.userId }] }] }
        : { status: { in: [...visibleStatuses] } }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.lostFoundReport.findMany({ where, include, ...toPagination(query), orderBy: { happenedAt: 'desc' } }),
    prisma.lostFoundReport.count({ where }),
  ]);
  const result = paginated(
    items.map((report) => dto(report, admin || report.reporterId === actor?.userId)),
    total,
    query.page,
    pageSize,
  );
  return { ...result, pagination: { ...result.pagination, totalPages: result.pagination.pages } };
};

export const listMyLostFound = async (userId: string, rawQuery: LostFoundQuery) =>
  listLostFound({ ...rawQuery, reporterId: userId }, { userId, role: Role.STUDENT });

export const getLostFound = async (id: string, actor?: { userId: string; role: Role }) => {
  const report = await prisma.lostFoundReport.findUnique({
    where: { id },
    include: {
      ...include,
      ...(actor && (actor.role === Role.ADMIN)
        ? {
            claims: {
              include: { claimant: { select: { id: true, name: true, email: true, phone: true } }, reviewedBy: { select: { id: true, name: true } } },
              orderBy: { createdAt: 'desc' as const },
            },
            lostMatches: { include: { foundReport: { include } } },
            foundMatches: { include: { lostReport: { include } } },
          }
        : {}),
    },
  });
  if (!report) throw new AppError(404, 'LOST_FOUND_NOT_FOUND', 'Lost-and-found report not found');
  const allowed =
    visibleStatuses.includes(report.status as (typeof visibleStatuses)[number]) ||
    actor?.role === Role.ADMIN ||
    actor?.userId === report.reporterId;
  if (!allowed) throw new AppError(404, 'LOST_FOUND_NOT_FOUND', 'Lost-and-found report not found');
  const serialized = dto(report, actor?.role === Role.ADMIN || actor?.userId === report.reporterId);
  return actor?.role === Role.ADMIN
    ? {
        ...serialized,
        claims: 'claims' in report ? report.claims : [],
        lostMatches: 'lostMatches' in report ? report.lostMatches : [],
        foundMatches: 'foundMatches' in report ? report.foundMatches : [],
      }
    : serialized;
};

const tokens = (value: string | null | undefined): Set<string> =>
  new Set(
    (value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );

const similarity = (left: string | null | undefined, right: string | null | undefined): number => {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap / new Set([...a, ...b]).size;
};

const matchScore = (left: ReportWithRelations, right: ReportWithRelations) => {
  const reasons: string[] = [];
  let score = 0;
  if (left.category.toLowerCase() === right.category.toLowerCase()) {
    score += 0.3;
    reasons.push('same category');
  }
  const textScore = similarity(`${left.title} ${left.description}`, `${right.title} ${right.description}`);
  score += textScore * 0.25;
  if (textScore >= 0.3) reasons.push('similar description');
  if (left.color && right.color && left.color.toLowerCase() === right.color.toLowerCase()) {
    score += 0.15;
    reasons.push('same color');
  }
  if (left.brand && right.brand && left.brand.toLowerCase() === right.brand.toLowerCase()) {
    score += 0.15;
    reasons.push('same brand');
  }
  const locationScore = similarity(left.locationText, right.locationText);
  score += locationScore * 0.1;
  if (locationScore >= 0.3) reasons.push('similar location');
  const daysApart = Math.abs(left.happenedAt.getTime() - right.happenedAt.getTime()) / 86_400_000;
  if (daysApart <= 2) {
    score += 0.05;
    reasons.push('close in time');
  }
  return { confidence: Math.min(1, Number(score.toFixed(4))), reasons };
};

export const findPotentialMatches = async (reportId: string): Promise<number> => {
  const report = await prisma.lostFoundReport.findUnique({ where: { id: reportId }, include });
  if (!report || !matchableReportStatuses.includes(report.status)) return 0;
  const candidates = await prisma.lostFoundReport.findMany({
    where: {
      id: { not: report.id },
      reporterId: { not: report.reporterId },
      type: report.type === LostFoundReportType.LOST ? LostFoundReportType.FOUND : LostFoundReportType.LOST,
      status: { in: [LostFoundStatus.OPEN, LostFoundStatus.MATCHED] },
      happenedAt: {
        gte: new Date(report.happenedAt.getTime() - 30 * 86_400_000),
        lte: new Date(report.happenedAt.getTime() + 30 * 86_400_000),
      },
    },
    include,
    orderBy: { happenedAt: 'desc' },
    take: 100,
  });
  const likely = candidates
    .map((candidate) => ({ candidate, ...matchScore(report, candidate) }))
    .filter(({ confidence }) => confidence >= 0.45)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 10);
  if (!likely.length) return 0;
  const matches = await prisma.$transaction(async (tx) => {
    const created = [];
    for (const { candidate, confidence, reasons } of likely) {
      const lostReportId = report.type === LostFoundReportType.LOST ? report.id : candidate.id;
      const foundReportId = report.type === LostFoundReportType.FOUND ? report.id : candidate.id;
      const match = await tx.lostFoundMatch.upsert({
        where: { lostReportId_foundReportId: { lostReportId, foundReportId } },
        create: { lostReportId, foundReportId, confidence, matchReasons: reasons },
        update: { confidence, matchReasons: reasons },
        include: { lostReport: { select: { reporterId: true, title: true } }, foundReport: { select: { reporterId: true, title: true } } },
      });
      created.push(match);
    }
    const reportIds = [...new Set(matches.flatMap((match) => [match.lostReportId, match.foundReportId]))];
    await tx.lostFoundReport.updateMany({
      where: { id: { in: reportIds }, status: LostFoundStatus.OPEN },
      data: { status: LostFoundStatus.MATCHED },
    });
    await tx.lostFoundMatch.updateMany({ where: { id: { in: matches.map(({ id }) => id) } }, data: { notifiedAt: new Date() } });
    return created;
  });
  for (const match of matches) {
    await Promise.all([
      notifyUser({
        userId: match.lostReport.reporterId,
        type: NotificationType.LOST_FOUND_MATCH,
        title: 'Potential lost-item match',
        body: `A found-item report may match “${match.lostReport.title}”. An administrator will review it.`,
        data: { matchId: match.id, reportId: match.lostReportId, confidence: Number(match.confidence) },
        dedupeKey: `lost-found-match:${match.id}:lost`,
      }),
      notifyUser({
        userId: match.foundReport.reporterId,
        type: NotificationType.LOST_FOUND_MATCH,
        title: 'Potential found-item match',
        body: `A lost-item report may match “${match.foundReport.title}”. An administrator will review it.`,
        data: { matchId: match.id, reportId: match.foundReportId, confidence: Number(match.confidence) },
        dedupeKey: `lost-found-match:${match.id}:found`,
      }),
    ]);
  }
  return matches.length;
};

export const createLostFound = async (
  input: CreateLostFoundInput,
  actor: { userId: string; role: Role },
  images: StoredLostFoundImage[],
  context?: AuditContext,
) => {
  const reporterId = actor.role === Role.ADMIN && input.reporterId ? input.reporterId : actor.userId;
  const status = actor.role === Role.ADMIN ? input.status ?? LostFoundStatus.OPEN : LostFoundStatus.PENDING_VERIFICATION;
  const created = await prisma.$transaction(async (tx) => {
    const reporter = await tx.user.findFirst({ where: { id: reporterId, status: UserStatus.ACTIVE } });
    if (!reporter) throw new AppError(404, 'REPORTER_NOT_FOUND', 'Reporter not found');
    const record = await tx.lostFoundReport.create({
      data: {
        reportNumber: reportNumber(),
        reporterId,
        verifiedById: actor.role === Role.ADMIN && status !== LostFoundStatus.PENDING_VERIFICATION ? actor.userId : undefined,
        type: input.type,
        status,
        category: input.category,
        title: input.title,
        description: input.description,
        color: input.color,
        brand: input.brand,
        locationText: input.locationText ?? input.location!,
        happenedAt: input.happenedAt ?? input.occurredAt!,
        latitude: input.latitude,
        longitude: input.longitude,
        verifiedAt: actor.role === Role.ADMIN && status !== LostFoundStatus.PENDING_VERIFICATION ? new Date() : undefined,
        images: {
          create: images.map((image, index) => ({ url: image.url, altText: input.title, sortOrder: index })),
        },
      },
      include,
    });
    if (context) {
      await writeAuditLog({ context, action: 'lostFound.create', entityType: 'LostFoundReport', entityId: record.id, after: record, client: tx });
    }
    return record;
  });
  if (matchableReportStatuses.includes(created.status)) await findPotentialMatches(created.id);
  return dto(created);
};

export const updateLostFound = async (
  id: string,
  input: UpdateLostFoundInput,
  actor: { userId: string; role: Role },
  context?: AuditContext,
) => {
  let shouldMatch = false;
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.lostFoundReport.findUnique({ where: { id }, include });
    if (!before) throw new AppError(404, 'LOST_FOUND_NOT_FOUND', 'Lost-and-found report not found');
    const admin = actor.role === Role.ADMIN;
    if (!admin && before.reporterId !== actor.userId) throw new AppError(403, 'FORBIDDEN', 'You can only edit your own report');
    if (
      !admin &&
      !([LostFoundStatus.PENDING_VERIFICATION, LostFoundStatus.OPEN] as LostFoundStatus[]).includes(before.status)
    ) {
      throw new AppError(409, 'REPORT_NOT_EDITABLE', 'This report can no longer be edited');
    }
    if (input.type && input.type !== before.type) {
      const matchCount = before._count.lostMatches + before._count.foundMatches;
      if (matchCount > 0) throw new AppError(409, 'REPORT_HAS_MATCHES', 'Report type cannot change after matching has started');
    }
    const status = admin ? input.status ?? before.status : LostFoundStatus.PENDING_VERIFICATION;
    shouldMatch = matchableReportStatuses.includes(status);
    const record = await tx.lostFoundReport.update({
      where: { id },
      data: {
        type: input.type,
        status,
        category: input.category,
        title: input.title,
        description: input.description,
        color: input.color,
        brand: input.brand,
        locationText: input.locationText ?? input.location,
        happenedAt: input.happenedAt ?? input.occurredAt,
        latitude: input.latitude,
        longitude: input.longitude,
        verificationNotes: admin ? input.verificationNotes : undefined,
        verifiedById: admin && shouldMatch ? actor.userId : undefined,
        verifiedAt: admin && shouldMatch ? before.verifiedAt ?? new Date() : undefined,
        closedAt: terminalReportStatuses.includes(status) ? new Date() : null,
      },
      include,
    });
    if (context) {
      await writeAuditLog({ context, action: 'lostFound.update', entityType: 'LostFoundReport', entityId: id, before, after: record, client: tx });
    }
    return record;
  });
  if (shouldMatch) await findPotentialMatches(id);
  return dto(updated);
};

export const deleteLostFound = async (
  id: string,
  actor: { userId: string; role: Role },
  context?: AuditContext,
) => {
  const urls = await prisma.$transaction(async (tx) => {
    const before = await tx.lostFoundReport.findUnique({ where: { id }, include });
    if (!before) throw new AppError(404, 'LOST_FOUND_NOT_FOUND', 'Lost-and-found report not found');
    const admin = actor.role === Role.ADMIN;
    if (!admin && before.reporterId !== actor.userId) throw new AppError(403, 'FORBIDDEN', 'You can only delete your own report');
    if (!admin && before.status !== LostFoundStatus.PENDING_VERIFICATION) {
      throw new AppError(409, 'REPORT_NOT_DELETABLE', 'Only unverified reports can be deleted');
    }
    if (before._count.claims > 0 && !([LostFoundStatus.CLOSED, LostFoundStatus.REJECTED] as LostFoundStatus[]).includes(before.status)) {
      throw new AppError(409, 'REPORT_HAS_CLAIMS', 'Resolve active claims before deleting this report');
    }
    await tx.lostFoundReport.delete({ where: { id } });
    if (context) {
      await writeAuditLog({ context, action: 'lostFound.delete', entityType: 'LostFoundReport', entityId: id, before, client: tx });
    }
    return before.images.map(({ url }) => url);
  });
  await removeLostFoundUrls(urls);
};

export const createLostFoundClaim = async (reportId: string, claimantId: string, input: CreateClaimInput) => {
  const claim = await prisma.$transaction(async (tx) => {
    const report = await tx.lostFoundReport.findUnique({ where: { id: reportId } });
    if (!report || report.type !== LostFoundReportType.FOUND || !claimableReportStatuses.includes(report.status)) {
      throw new AppError(409, 'REPORT_NOT_CLAIMABLE', 'This found-item report is not accepting claims');
    }
    if (report.reporterId === claimantId) throw new AppError(409, 'OWN_REPORT', 'You cannot claim an item you reported as found');
    const ownershipProof = input.ownershipProof ?? input.evidence!;
    const created = await tx.lostFoundClaim.create({
      data: {
        reportId,
        claimantId,
        ownershipProof: input.contact ? `${ownershipProof}\nContact: ${input.contact}` : ownershipProof,
      },
      include: { report: { select: { title: true } }, claimant: { select: { id: true, name: true } } },
    });
    if (report.status !== LostFoundStatus.CLAIM_PENDING) {
      await tx.lostFoundReport.update({ where: { id: reportId }, data: { status: LostFoundStatus.CLAIM_PENDING } });
    }
    return created;
  });
  const admins = await prisma.user.findMany({ where: { role: Role.ADMIN, status: UserStatus.ACTIVE }, select: { id: true } });
  await notifyUsers(admins.map(({ id }) => id), {
    type: NotificationType.SYSTEM,
    title: 'Lost-and-found claim awaiting review',
    body: `${claim.claimant.name} submitted a claim for “${claim.report.title}”.`,
    data: { reportId, claimId: claim.id },
    dedupePrefix: `lost-found-claim:${claim.id}`,
  });
  return claim;
};

export const reviewLostFoundClaim = async (claimId: string, input: ReviewClaimInput, context: AuditContext) => {
  const reviewed = await prisma.$transaction(async (tx) => {
    const before = await tx.lostFoundClaim.findUnique({ where: { id: claimId }, include: { report: true } });
    if (!before) throw new AppError(404, 'CLAIM_NOT_FOUND', 'Lost-and-found claim not found');
    if (before.status !== ClaimStatus.PENDING) throw new AppError(409, 'CLAIM_ALREADY_REVIEWED', 'This claim has already been reviewed');
    const claim = await tx.lostFoundClaim.update({
      where: { id: claimId },
      data: { status: input.status, reviewNotes: input.reviewNotes, reviewedById: context.actorId, reviewedAt: new Date() },
      include: { report: true, claimant: { select: { id: true, name: true } } },
    });
    if (input.status === ClaimStatus.APPROVED) {
      await tx.lostFoundClaim.updateMany({
        where: { reportId: claim.reportId, id: { not: claim.id }, status: ClaimStatus.PENDING },
        data: { status: ClaimStatus.REJECTED, reviewNotes: 'Another claim was approved', reviewedById: context.actorId, reviewedAt: new Date() },
      });
      await tx.lostFoundReport.update({ where: { id: claim.reportId }, data: { status: LostFoundStatus.CLAIMED } });
    } else {
      const pending = await tx.lostFoundClaim.count({ where: { reportId: claim.reportId, status: ClaimStatus.PENDING } });
      if (!pending) await tx.lostFoundReport.update({ where: { id: claim.reportId }, data: { status: LostFoundStatus.OPEN } });
    }
    await writeAuditLog({ context, action: 'lostFoundClaim.review', entityType: 'LostFoundClaim', entityId: claimId, before, after: claim, client: tx });
    return claim;
  });
  await notifyUser({
    userId: reviewed.claimantId,
    type: NotificationType.SYSTEM,
    title: `Item claim ${reviewed.status.toLowerCase()}`,
    body: input.reviewNotes,
    data: { claimId: reviewed.id, reportId: reviewed.reportId, status: reviewed.status },
    dedupeKey: `lost-found-claim-reviewed:${reviewed.id}`,
  });
  return reviewed;
};

export const reviewLostFoundMatch = async (matchId: string, input: ReviewMatchInput, context: AuditContext) => {
  const reviewed = await prisma.$transaction(async (tx) => {
    const before = await tx.lostFoundMatch.findUnique({
      where: { id: matchId },
      include: {
        lostReport: { select: { id: true, reporterId: true, title: true } },
        foundReport: { select: { id: true, reporterId: true, title: true } },
      },
    });
    if (!before) throw new AppError(404, 'MATCH_NOT_FOUND', 'Potential match not found');
    if (!canTransitionLostFoundMatch(before.status, input.status)) {
      throw new AppError(409, 'INVALID_MATCH_TRANSITION', `A ${before.status.toLowerCase()} match cannot become ${input.status.toLowerCase()}`);
    }
    const now = new Date();
    const changed = await tx.lostFoundMatch.updateMany({
      where: { id: matchId, status: before.status },
      data: {
        status: input.status,
        resolvedAt: ([MatchStatus.REJECTED, MatchStatus.RESOLVED] as MatchStatus[]).includes(input.status) ? now : null,
      },
    });
    if (changed.count !== 1) throw new AppError(409, 'MATCH_CHANGED', 'This match was updated by another administrator');

    const reportIds = [before.lostReportId, before.foundReportId];
    if (input.status === MatchStatus.CONFIRMED) {
      await tx.lostFoundReport.updateMany({
        where: { id: { in: reportIds }, status: LostFoundStatus.OPEN },
        data: { status: LostFoundStatus.MATCHED },
      });
    } else if (input.status === MatchStatus.RESOLVED) {
      await tx.lostFoundReport.updateMany({
        where: { id: { in: reportIds }, status: { notIn: terminalReportStatuses } },
        data: { status: LostFoundStatus.RETURNED, closedAt: now },
      });
    } else {
      for (const reportId of reportIds) {
        const activeMatches = await tx.lostFoundMatch.count({
          where: {
            status: { in: [MatchStatus.SUGGESTED, MatchStatus.CONFIRMED] },
            OR: [{ lostReportId: reportId }, { foundReportId: reportId }],
          },
        });
        if (activeMatches === 0) {
          await tx.lostFoundReport.updateMany({
            where: { id: reportId, status: LostFoundStatus.MATCHED },
            data: { status: LostFoundStatus.OPEN },
          });
        }
      }
    }

    const match = await tx.lostFoundMatch.findUniqueOrThrow({
      where: { id: matchId },
      include: {
        lostReport: { select: { id: true, reporterId: true, title: true } },
        foundReport: { select: { id: true, reporterId: true, title: true } },
      },
    });
    await writeAuditLog({ context, action: 'lostFoundMatch.review', entityType: 'LostFoundMatch', entityId: matchId, before, after: match, client: tx });
    return match;
  });
  await notifyUsers([reviewed.lostReport.reporterId, reviewed.foundReport.reporterId], {
    type: NotificationType.LOST_FOUND_MATCH,
    title: reviewed.status === MatchStatus.RESOLVED ? 'Lost item returned' : `Item match ${reviewed.status.toLowerCase()}`,
    body:
      reviewed.status === MatchStatus.CONFIRMED
        ? 'The transport office confirmed a potential match. Contact the office to complete the claim safely.'
        : reviewed.status === MatchStatus.RESOLVED
          ? 'The transport office marked the matched item as returned.'
          : 'The transport office reviewed the potential match and determined it was not the same item.',
    data: { matchId: reviewed.id, status: reviewed.status },
    dedupePrefix: `lost-found-match-reviewed:${reviewed.id}:${reviewed.status}`,
  });
  return reviewed;
};
