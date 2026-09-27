import { CreditTransactionType, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateProfiles: vi.fn(),
  findProfile: vi.fn(),
  findProfileOrThrow: vi.fn(),
  createLedgerEntry: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../../realtime/hub.js', () => ({ emitToUser: vi.fn() }));
vi.mock('../notifications/notification.service.js', () => ({ notifyUser: vi.fn() }));
vi.mock('../admin/audit.service.js', () => ({ writeAuditLog: vi.fn() }));

import { applyCreditChange, recordCreditAdjustment } from './credit.service.js';

const tx = {
  studentProfile: { updateMany: mocks.updateProfiles, findUnique: mocks.findProfile, findUniqueOrThrow: mocks.findProfileOrThrow },
  creditTransaction: { create: mocks.createLedgerEntry },
} as unknown as Prisma.TransactionClient;

describe('student credits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createLedgerEntry.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: 'ledger-1', ...data }));
  });

  it('spends credits only while the balance covers the amount', async () => {
    mocks.updateProfiles.mockResolvedValue({ count: 1 });
    mocks.findProfileOrThrow.mockResolvedValue({ creditBalance: new Prisma.Decimal(70) });

    const result = await applyCreditChange(tx, { studentId: 'student-1', type: CreditTransactionType.BOOKING_PAYMENT, amount: -50 });

    const update = (mocks.updateProfiles.mock.calls[0] as [{ where: { creditBalance: { gte: Prisma.Decimal } }; data: { creditBalance: { increment: Prisma.Decimal } } }])[0];
    expect(update.where.creditBalance.gte.toNumber()).toBe(50);
    expect(update.data.creditBalance.increment.toNumber()).toBe(-50);
    expect(result.balance.toNumber()).toBe(70);
    expect(mocks.createLedgerEntry).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: CreditTransactionType.BOOKING_PAYMENT, balanceAfter: new Prisma.Decimal(70) }) as unknown,
    }));
  });

  it('refuses a spend larger than the balance and records nothing', async () => {
    mocks.updateProfiles.mockResolvedValue({ count: 0 });
    mocks.findProfile.mockResolvedValue({ creditBalance: new Prisma.Decimal(20) });

    await expect(applyCreditChange(tx, { studentId: 'student-1', type: CreditTransactionType.BOOKING_PAYMENT, amount: -50 }))
      .rejects.toMatchObject({ statusCode: 409, code: 'INSUFFICIENT_CREDITS', details: { required: 50, balance: 20 } });
    expect(mocks.createLedgerEntry).not.toHaveBeenCalled();
  });

  it('adds credits without a balance condition', async () => {
    mocks.updateProfiles.mockResolvedValue({ count: 1 });
    mocks.findProfileOrThrow.mockResolvedValue({ creditBalance: new Prisma.Decimal(500) });

    await applyCreditChange(tx, { studentId: 'student-1', type: CreditTransactionType.TOP_UP, amount: 500, reference: ' RCPT-1 ' });

    const update = (mocks.updateProfiles.mock.calls[0] as [{ where: object }])[0];
    expect(update.where).toEqual({ userId: 'student-1' });
    expect(mocks.createLedgerEntry).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reference: 'RCPT-1' }) as unknown }));
  });

  it('rejects a zero change', async () => {
    await expect(applyCreditChange(tx, { studentId: 'student-1', type: CreditTransactionType.ADJUSTMENT, amount: 0 }))
      .rejects.toMatchObject({ code: 'INVALID_CREDIT_AMOUNT' });
  });

  it('requires the office receipt number for a top-up and a reason for a deduction', async () => {
    const context = { actorId: 'admin-1' };
    await expect(recordCreditAdjustment({ studentId: 'student-1', action: 'top_up', amount: 100 }, context))
      .rejects.toMatchObject({ code: 'RECEIPT_REFERENCE_REQUIRED' });
    await expect(recordCreditAdjustment({ studentId: 'student-1', action: 'deduct', amount: 100, note: '  ' }, context))
      .rejects.toMatchObject({ code: 'ADJUSTMENT_REASON_REQUIRED' });
  });
});
