/**
 * The front seats of every bus are kept for teachers, who board without an app booking.
 * Callers must pass the bus seats ordered by `rowNumber`, then `seatNumber`, so the catalog
 * and the booking service agree on which seats are reserved.
 */
export const RESERVED_TEACHER_SEAT_COUNT = 2;

export const seatOrder = [{ rowNumber: 'asc' as const }, { seatNumber: 'asc' as const }];

export const reservedSeatIds = (orderedSeats: ReadonlyArray<{ id: string }>): Set<string> =>
  new Set(orderedSeats.slice(0, RESERVED_TEACHER_SEAT_COUNT).map((seat) => seat.id));
