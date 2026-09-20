import { BaseRepository } from './BaseRepository';
import { api, unwrap } from '../lib/api';

export class BookingRepository extends BaseRepository<any> {
  constructor() {
    super('/student/bookings');
  }

  async holdSeat(tripId: string, seatNumber: string): Promise<any> {
    const response = await api.post<any>('/trips/' + tripId + '/seat-holds', { seatNumber });
    return unwrap(response);
  }

  async releaseSeat(holdId: string, tripId: string): Promise<any> {
    const response = await api.post<any>(`/student/bookings/release`, { holdId, tripId });
    return unwrap(response);
  }

  async finalize(data: { seatHoldId: string; tripId: string; seatNumber: string; pickupStopId?: string; boardingStopId?: string; destinationStopId: string; subscriptionId?: string }, idempotencyKey?: string): Promise<any> {
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
    const response = await api.post('/bookings', data, headers);
    return unwrap(response);
  }

  async cancelBooking(id: string, reason: string) {
    const response = await api.post(`/student/bookings/${id}/cancel`, { reason });
    return unwrap(response);
  }
}

export const bookingRepository = new BookingRepository();
