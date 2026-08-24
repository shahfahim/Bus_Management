import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../lib/prisma.js';

export interface AuditContext {
  actorId: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export const auditContext = (request: Request): AuditContext => {
  const requestId = request.id;
  return {
    actorId: request.auth!.userId,
    requestId:
      typeof requestId === 'string'
        ? requestId
        : typeof requestId === 'number'
          ? requestId.toString()
          : undefined,
    ipAddress: request.ip,
    userAgent: request.get('user-agent')?.slice(0, 2_000),
  };
};

const asJson = (value: unknown): Prisma.InputJsonValue | undefined => {
  if (value === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_key, candidate: unknown) =>
      typeof candidate === 'bigint' ? candidate.toString() : candidate,
    ),
  ) as Prisma.InputJsonValue;
};

export const writeAuditLog = async ({
  context,
  action,
  entityType,
  entityId,
  before,
  after,
  metadata,
  client = prisma,
}: {
  context: AuditContext;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  client?: Prisma.TransactionClient | typeof prisma;
}) =>
  client.auditLog.create({
    data: {
      actorId: context.actorId,
      action,
      entityType,
      entityId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      before: asJson(before),
      after: asJson(after),
      metadata: asJson(metadata),
    },
  });
