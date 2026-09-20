import { BookingStatus, Prisma, SeatAllocationStatus } from '@prisma/client';
import { AppError } from '../../lib/errors.js';

export interface BookingTransitionContext {
  now: Date;
  reason?: string;
}

export abstract class BookingState {
  constructor(protected status: BookingStatus) {}

  getStatus(): BookingStatus {
    return this.status;
  }

  confirm(context: BookingTransitionContext): Prisma.BookingUpdateInput {
    throw new AppError(400, 'INVALID_STATE_TRANSITION', `Cannot confirm booking from state ${this.status}`);
  }

  cancel(context: BookingTransitionContext): Prisma.BookingUpdateInput {
    throw new AppError(400, 'INVALID_STATE_TRANSITION', `Cannot cancel booking from state ${this.status}`);
  }

  checkIn(context: BookingTransitionContext): Prisma.BookingUpdateInput {
    throw new AppError(400, 'INVALID_STATE_TRANSITION', `Cannot check-in booking from state ${this.status}`);
  }

  expire(context: BookingTransitionContext): Prisma.BookingUpdateInput {
    throw new AppError(400, 'INVALID_STATE_TRANSITION', `Cannot expire booking from state ${this.status}`);
  }
}

export class HeldState extends BookingState {
  constructor() {
    super(BookingStatus.HELD);
  }

  confirm(context: BookingTransitionContext): Prisma.BookingUpdateInput {
    return {
      status: BookingStatus.CONFIRMED,
      confirmedAt: context.now,
      holdExpiresAt: null,
      version: { increment: 1 },
      seatAllocations: {
        updateMany: {
          where: { status: SeatAllocationStatus.HELD },
          data: { status: SeatAllocationStatus.CONFIRMED },
        },
      },
    };
  }

  cancel(context: BookingTransitionContext): Prisma.BookingUpdateInput {
    return {
      status: BookingStatus.CANCELLED,
      cancelledAt: context.now,
      cancellationReason: context.reason ?? 'Cancelled',
      version: { increment: 1 },
      seatAllocations: {
        updateMany: {
          where: { status: SeatAllocationStatus.HELD },
          data: { status: SeatAllocationStatus.RELEASED, releasedAt: context.now, releaseReason: context.reason },
        },
      },
    };
  }

  expire(context: BookingTransitionContext): Prisma.BookingUpdateInput {
    return {
      status: BookingStatus.EXPIRED,
      version: { increment: 1 },
      seatAllocations: {
        updateMany: {
          where: { status: SeatAllocationStatus.HELD },
          data: { status: SeatAllocationStatus.EXPIRED, releasedAt: context.now, releaseReason: 'Booking hold expired' },
        },
      },
    };
  }
}

export class PendingPaymentState extends BookingState {
  constructor() {
    super(BookingStatus.PENDING_PAYMENT);
  }

  confirm(context: BookingTransitionContext): Prisma.BookingUpdateInput {
    return {
      status: BookingStatus.CONFIRMED,
      confirmedAt: context.now,
      holdExpiresAt: null,
      version: { increment: 1 },
      seatAllocations: {
        updateMany: {
          where: { status: SeatAllocationStatus.HELD },
          data: { status: SeatAllocationStatus.CONFIRMED },
        },
      },
    };
  }

  cancel(context: BookingTransitionContext): Prisma.BookingUpdateInput {
    return {
      status: BookingStatus.CANCELLED,
      cancelledAt: context.now,
      cancellationReason: context.reason ?? 'Cancelled',
      version: { increment: 1 },
      seatAllocations: {
        updateMany: {
          where: { status: SeatAllocationStatus.HELD },
          data: { status: SeatAllocationStatus.RELEASED, releasedAt: context.now, releaseReason: context.reason },
        },
      },
    };
  }

  expire(context: BookingTransitionContext): Prisma.BookingUpdateInput {
    return {
      status: BookingStatus.EXPIRED,
      version: { increment: 1 },
      seatAllocations: {
        updateMany: {
          where: { status: SeatAllocationStatus.HELD },
          data: { status: SeatAllocationStatus.EXPIRED, releasedAt: context.now, releaseReason: 'Payment timeout' },
        },
      },
    };
  }
}

export class ConfirmedState extends BookingState {
  constructor() {
    super(BookingStatus.CONFIRMED);
  }

  cancel(context: BookingTransitionContext): Prisma.BookingUpdateInput {
    return {
      status: BookingStatus.CANCELLED,
      cancelledAt: context.now,
      cancellationReason: context.reason ?? 'Cancelled',
      version: { increment: 1 },
      seatAllocations: {
        updateMany: {
          where: { status: SeatAllocationStatus.CONFIRMED },
          data: { status: SeatAllocationStatus.RELEASED, releasedAt: context.now, releaseReason: context.reason },
        },
      },
    };
  }

  checkIn(context: BookingTransitionContext): Prisma.BookingUpdateInput {
    return {
      status: BookingStatus.CHECKED_IN,
      checkedInAt: context.now,
      version: { increment: 1 },
    };
  }
}

export class BookingStateFactory {
  static getState(status: BookingStatus): BookingState {
    switch (status) {
      case BookingStatus.HELD:
        return new HeldState();
      case BookingStatus.PENDING_PAYMENT:
        return new PendingPaymentState();
      case BookingStatus.CONFIRMED:
        return new ConfirmedState();
      default:
        class TerminalState extends BookingState {
          constructor() {
            super(status);
          }
        }
        return new TerminalState();
    }
  }
}
