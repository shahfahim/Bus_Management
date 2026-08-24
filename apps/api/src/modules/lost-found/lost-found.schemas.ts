import { ClaimStatus, LostFoundReportType, LostFoundStatus, MatchStatus } from '@prisma/client';
import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination.js';

const normalize = (value: string): string => value.trim().toUpperCase().replaceAll('-', '_').replaceAll(' ', '_');

const enumValue = <T extends z.EnumLike>(values: T, aliases: Record<string, string> = {}) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const normalized = normalize(value);
    return aliases[normalized] ?? normalized;
  }, z.nativeEnum(values));

const statusAliases = {
  PENDING: LostFoundStatus.PENDING_VERIFICATION,
  VERIFIED: LostFoundStatus.OPEN,
  POTENTIAL_MATCH: LostFoundStatus.MATCHED,
} as const;

const statusList = z.preprocess(
  (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
  z.array(enumValue(LostFoundStatus, statusAliases)).max(20),
);

export const lostFoundQuerySchema = paginationSchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  type: enumValue(LostFoundReportType).optional(),
  status: statusList.optional(),
  category: z.string().trim().max(80).optional(),
  reporterId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const createLostFoundSchema = z
  .object({
    reporterId: z.string().uuid().optional(),
    type: enumValue(LostFoundReportType),
    status: enumValue(LostFoundStatus, statusAliases).optional(),
    category: z.string().trim().min(2).max(80),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(5).max(5_000),
    color: z.string().trim().max(64).optional(),
    brand: z.string().trim().max(96).optional(),
    locationText: z.string().trim().min(2).max(1_000).optional(),
    location: z.string().trim().min(2).max(1_000).optional(),
    happenedAt: z.coerce.date().optional(),
    occurredAt: z.coerce.date().optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
  })
  .superRefine((value, context) => {
    if (!value.locationText && !value.location) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['location'], message: 'Location is required' });
    }
    if (!value.happenedAt && !value.occurredAt) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['occurredAt'], message: 'Date and time are required' });
    }
    const happenedAt = value.happenedAt ?? value.occurredAt;
    if (happenedAt && happenedAt > new Date(Date.now() + 5 * 60_000)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['occurredAt'], message: 'Date and time cannot be in the future' });
    }
    if ((value.latitude === undefined) !== (value.longitude === undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['latitude'], message: 'Latitude and longitude must be provided together' });
    }
  });

export const updateLostFoundSchema = z
  .object({
    type: enumValue(LostFoundReportType).optional(),
    status: enumValue(LostFoundStatus, statusAliases).optional(),
    category: z.string().trim().min(2).max(80).optional(),
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().min(5).max(5_000).optional(),
    color: z.string().trim().max(64).nullable().optional(),
    brand: z.string().trim().max(96).nullable().optional(),
    locationText: z.string().trim().min(2).max(1_000).optional(),
    location: z.string().trim().min(2).max(1_000).optional(),
    happenedAt: z.coerce.date().optional(),
    occurredAt: z.coerce.date().optional(),
    latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
    longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
    verificationNotes: z.string().trim().max(5_000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const createClaimSchema = z
  .object({
    ownershipProof: z.string().trim().min(10).max(5_000).optional(),
    evidence: z.string().trim().min(10).max(5_000).optional(),
    contact: z.string().trim().min(5).max(100).optional(),
  })
  .refine((value) => value.ownershipProof || value.evidence, { path: ['evidence'], message: 'Proof of ownership is required' });

export const reviewClaimSchema = z.object({
  status: enumValue(ClaimStatus).refine(
    (status) => ([ClaimStatus.APPROVED, ClaimStatus.REJECTED] as ClaimStatus[]).includes(status),
    'Review must approve or reject the claim',
  ),
  reviewNotes: z.string().trim().min(3).max(5_000),
});

export const reviewMatchSchema = z.object({
  status: enumValue(MatchStatus).refine(
    (status) => ([MatchStatus.CONFIRMED, MatchStatus.REJECTED, MatchStatus.RESOLVED] as MatchStatus[]).includes(status),
    'Invalid match review status',
  ),
});
