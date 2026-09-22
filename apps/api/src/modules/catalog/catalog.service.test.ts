import { BookingStatus, SeatAllocationStatus, SeatStatus, SeatType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findTrip: vi.fn() }));

vi.mock('../../lib/prisma.js', () => ({
  prisma: { trip: { findUnique: mocks.findTrip } },
}));

import { getTripSeats } from './catalog.service.js';

describe('trip seat hold recovery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the current user hold so selection survives a refresh', async () => {
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    mocks.findTrip.mockResolvedValue({
      id: 'trip-1',
      bus: {
        seats: [
          {
            id: 'seat-1',
            seatNumber: '08',
            rowNumber: 2,
            columnLabel: 'D',
            type: SeatType.STANDARD,
            status: SeatStatus.ACTIVE,
          },
        ],
      },
      seatAllocations: [
        {
          seatId: 'seat-1',
          status: SeatAllocationStatus.HELD,
          booking: {
            id: 'booking-hold-1',
            studentId: 'student-1',
            status: BookingStatus.HELD,
            holdExpiresAt: expiresAt,
          },
        },
      ],
    });

    const result = await getTripSeats('trip-1', 'student-1');

    expect(result.currentHold).toEqual({ id: 'booking-hold-1', seatNumber: '08', expiresAt });
    expect(result.items[0]).toMatchObject({ number: '08', status: 'HELD', heldByCurrentUser: true });
  });

  it('reports the two front seats as reserved for teachers', async () => {
    const seat = (id: string, rowNumber: number) => ({
      id,
      seatNumber: id,
      rowNumber,
      columnLabel: 'A',
      type: SeatType.STANDARD,
      status: SeatStatus.ACTIVE,
    });
    mocks.findTrip.mockResolvedValue({
      id: 'trip-1',
      bus: { seats: [seat('1', 1), seat('2', 1), seat('3', 2)] },
      seatAllocations: [],
    });

    const result = await getTripSeats('trip-1', 'student-1');

    expect(result.items.map((item) => [item.number, item.status, item.reserved])).toEqual([
      ['1', 'BLOCKED', true],
      ['2', 'BLOCKED', true],
      ['3', 'AVAILABLE', false],
    ]);
  });
});
