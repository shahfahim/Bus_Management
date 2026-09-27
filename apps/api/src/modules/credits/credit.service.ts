import { randomBytes } from 'node:crypto';
import {
  CreditTransactionType,
  NotificationType,
  PaymentMethodType,
  PaymentStatus,
  PaymentTransactionStatus,
  PaymentTransactionType,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { paginated, toPagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { emitToUser } from '../../realtime/hub.js';
import type { AuditContext } from '../admin/audit.service.js';
import { writeAuditLog } from '../admin/audit.service.js';
import { notifyUser } from '../notifications/notification.service.js';

/** Credits are bought at the university office: one credit is worth one taka. */
export const CREDIT_CURRENCY = 'BDT';
export const CREDIT_PROVIDER = 'credits';

const dated = (prefix: string): string =>
  `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(5).toString('hex').toUpperCase()}`;

export const formatCredits = (value: Prisma.Decimal | number): string =>
  `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} credits`;

interface CreditChange {
  studentId: string;
  type: CreditTransactionType;
  /** Positive adds credits, negative spends them. */
  amount: Prisma.Decimal | number | string;
  reference?: string | null;
  note?: string | null;
  paymentId?: string | null;
  createdById?: string | null;
}

/**
 * Changes a student's balance and records it in the ledger, inside the caller's transaction.
 * The conditional update is atomic, so concurrent spends can never push the balance below zero
 * (the database CHECK constraint is a second guard).
 */
export const applyCreditChange = async (tx: Prisma.TransactionClient, change: CreditChange) => {
  const delta = new Prisma.Decimal(change.amount).toDecimalPlaces(2);
  if (delta.isZero()) throw new AppError(400, 'INVALID_CREDIT_AMOUNT', 'The credit amount must not be zero');
  const updated = await tx.studentProfile.updateMany({
    where: { userId: change.studentId, ...(delta.isNegative() ? { creditBalance: { gte: delta.negated() } } : {}) },
    data: { creditBalance: { increment: delta } },
  });
  if (updated.count !== 1) {
    const profile = await tx.studentProfile.findUnique({ where: { userId: change.studentId }, select: { creditBalance: true } });
    if (!profile) throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    throw new AppError(
      409,
      'INSUFFICIENT_CREDITS',
      `This needs ${formatCredits(delta.negated())} but the balance is ${formatCredits(profile.creditBalance)}. Top up at the transport office.`,
      { required: Number(delta.negated()), balance: Number(profile.creditBalance) },
    );
  }
  const { creditBalance } = await tx.studentProfile.findUniqueOrThrow({
    where: { userId: change.studentId },
    select: { creditBalance: true },
  });
  const transaction = await tx.creditTransaction.create({
    data: {
      studentId: change.studentId,
      type: change.type,
      amount: delta,
      balanceAfter: creditBalance,
      reference: change.reference?.trim() || null,
      note: change.note?.trim() || null,
      paymentId: change.paymentId ?? null,
      createdById: change.createdById ?? null,
    },
  });
  return { transaction, balance: creditBalance };
};

/**
 * Pays for a booking or a travel pass from the student's credits and records it as a settled
 * payment with a receipt, so finance reports, receipts and refunds keep working unchanged.
 */
export const chargeCredits = async (
  tx: Prisma.TransactionClient,
  input: {
    studentId: string;
    amount: Prisma.Decimal | number;
    currency: string;
    bookingId?: string;
    subscriptionId?: string;
    description: string;
    idempotencyKey?: string;
  },
) => {
  const amount = new Prisma.Decimal(input.amount).toDecimalPlaces(2);
  if (!amount.isPositive()) throw new AppError(400, 'INVALID_CREDIT_AMOUNT', 'Nothing to charge');
  const now = new Date();
  const payment = await tx.payment.create({
    data: {
      paymentNumber: dated('PAY'),
      payerId: input.studentId,
      bookingId: input.bookingId,
      subscriptionId: input.subscriptionId,
      idempotencyKey: input.idempotencyKey ?? `credits:${input.bookingId ?? input.subscriptionId}:${randomBytes(12).toString('hex')}`,
      provider: CREDIT_PROVIDER,
      status: PaymentStatus.SUCCEEDED,
      methodType: PaymentMethodType.CREDITS,
      amount,
      currency: input.currency,
      paidAt: now,
      metadata: { description: input.description },
    },
  });
  const { transaction, balance } = await applyCreditChange(tx, {
    studentId: input.studentId,
    type: input.bookingId ? CreditTransactionType.BOOKING_PAYMENT : CreditTransactionType.PASS_PURCHASE,
    amount: amount.negated(),
    reference: payment.paymentNumber,
    note: input.description,
    paymentId: payment.id,
  });
  await tx.paymentTransaction.create({
    data: {
      paymentId: payment.id,
      provider: CREDIT_PROVIDER,
      providerTransactionId: transaction.id,
      type: PaymentTransactionType.CHARGE,
      status: PaymentTransactionStatus.SUCCEEDED,
      amount,
      currency: input.currency,
      processedAt: now,
    },
  });
  await tx.paymentReceipt.create({
    data: {
      paymentId: payment.id,
      receiptNumber: dated('RCT'),
      breakdown: { subtotal: Number(amount), total: Number(amount), currency: input.currency, paidWith: 'credits', balanceAfter: Number(balance) },
    },
  });
  return { payment, balance };
};

const creditTransactionDto = (
  transaction: Prisma.CreditTransactionGetPayload<{ include: { createdBy: { select: { id: true; name: true } } } }>,
) => ({
  id: transaction.id,
  type: transaction.type,
  amount: Number(transaction.amount),
  balanceAfter: Number(transaction.balanceAfter),
  reference: transaction.reference,
  note: transaction.note,
  paymentId: transaction.paymentId,
  recordedBy: transaction.createdBy?.name ?? null,
  createdAt: transaction.createdAt,
});

export const getStudentCredits = async (studentId: string, query: { page: number; pageSize: number }) => {
  const profile = await prisma.studentProfile.findUnique({ where: { userId: studentId }, select: { creditBalance: true } });
  if (!profile) throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student profile not found');
  const where = { studentId };
  const [items, total] = await prisma.$transaction([
    prisma.creditTransaction.findMany({
      where,
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      ...toPagination(query),
    }),
    prisma.creditTransaction.count({ where }),
  ]);
  return {
    balance: Number(profile.creditBalance),
    currency: CREDIT_CURRENCY,
    ...paginated(items.map(creditTransactionDto), total, query.page, query.pageSize),
  };
};

// ---------------------------------------------------------------- Administration

const adminLedgerInclude = {
  createdBy: { select: { id: true, name: true } },
  student: {
    select: {
      studentNumber: true,
      creditBalance: true,
      user: { select: { id: true, name: true, email: true } },
    },
  },
} as const;

type AdminLedgerRecord = Prisma.CreditTransactionGetPayload<{ include: typeof adminLedgerInclude }>;

const adminLedgerDto = (transaction: AdminLedgerRecord) => ({
  ...creditTransactionDto(transaction),
  type: transaction.type.toLowerCase(),
  student: {
    id: transaction.student.user.id,
    name: transaction.student.user.name,
    email: transaction.student.user.email,
    studentNumber: transaction.student.studentNumber,
    balance: Number(transaction.student.creditBalance),
  },
});

export const listCreditLedger = async (query: {
  page: number;
  pageSize: number;
  search?: string;
  type?: CreditTransactionType;
  studentId?: string;
}) => {
  const where: Prisma.CreditTransactionWhereInput = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.studentId ? { studentId: query.studentId } : {}),
    ...(query.search
      ? {
          OR: [
            { reference: { contains: query.search, mode: 'insensitive' } },
            { student: { studentNumber: { contains: query.search, mode: 'insensitive' } } },
            { student: { user: { name: { contains: query.search, mode: 'insensitive' } } } },
            { student: { user: { email: { contains: query.search, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.creditTransaction.findMany({ where, include: adminLedgerInclude, orderBy: { createdAt: 'desc' }, ...toPagination(query) }),
    prisma.creditTransaction.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  return {
    items: items.map(adminLedgerDto),
    pagination: { page: query.page, pageSize: query.pageSize, total, pages: totalPages, totalPages },
    meta: { page: query.page, pageSize: query.pageSize, total, totalPages },
  };
};

export const getCreditLedgerEntry = async (id: string) => {
  const entry = await prisma.creditTransaction.findUnique({ where: { id }, include: adminLedgerInclude });
  if (!entry) throw new AppError(404, 'CREDIT_TRANSACTION_NOT_FOUND', 'Credit transaction not found');
  return adminLedgerDto(entry);
};

/**
 * Records credits a student bought at the university office (top-up), or corrects a balance
 * (deduction). A top-up needs the office's money receipt number, which can be used only once.
 */
export const recordCreditAdjustment = async (
  input: { studentId: string; action: 'top_up' | 'deduct'; amount: number; reference?: string; note?: string },
  context: AuditContext,
) => {
  const reference = input.reference?.trim();
  if (input.action === 'top_up' && !reference) {
    throw new AppError(400, 'RECEIPT_REFERENCE_REQUIRED', 'Enter the university money receipt number for this top-up');
  }
  if (input.action === 'deduct' && !input.note?.trim()) {
    throw new AppError(400, 'ADJUSTMENT_REASON_REQUIRED', 'Explain why credits are being removed');
  }
  const amount = new Prisma.Decimal(input.amount).toDecimalPlaces(2);
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const student = await tx.studentProfile.findUnique({ where: { userId: input.studentId }, include: { user: true } });
      if (!student || student.user.deletedAt) throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
      if (input.action === 'top_up' && student.user.status !== UserStatus.ACTIVE) {
        throw new AppError(409, 'STUDENT_NOT_ACTIVE', 'Credits can be added only to active student accounts');
      }
      const change = await applyCreditChange(tx, {
        studentId: input.studentId,
        type: input.action === 'top_up' ? CreditTransactionType.TOP_UP : CreditTransactionType.ADJUSTMENT,
        amount: input.action === 'top_up' ? amount : amount.negated(),
        reference,
        note: input.note,
        createdById: context.actorId,
      });
      const entry = await tx.creditTransaction.findUniqueOrThrow({ where: { id: change.transaction.id }, include: adminLedgerInclude });
      await writeAuditLog({
        context,
        action: input.action === 'top_up' ? 'credits.top_up' : 'credits.deduct',
        entityType: 'CreditTransaction',
        entityId: entry.id,
        after: adminLedgerDto(entry),
        metadata: { studentId: input.studentId, reference, note: input.note },
        client: tx,
      });
      return entry;
    });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'RECEIPT_ALREADY_USED', 'That money receipt has already been credited');
    }
    throw error;
  }
  const dto = adminLedgerDto(result);
  await notifyUser({
    userId: input.studentId,
    type: NotificationType.SYSTEM,
    title: input.action === 'top_up' ? 'Credits added' : 'Credits adjusted',
    body:
      input.action === 'top_up'
        ? `${formatCredits(amount)} were added for receipt ${reference}. Balance: ${formatCredits(dto.balanceAfter)}.`
        : `${formatCredits(amount)} were removed: ${input.note?.trim()}. Balance: ${formatCredits(dto.balanceAfter)}.`,
    data: { creditTransactionId: dto.id, actionUrl: '/student/credits' },
    dedupeKey: `credits:${dto.id}`,
  });
  emitToUser(input.studentId, 'credits:updated', { balance: dto.balanceAfter });
  return dto;
};
