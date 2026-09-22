/* eslint-disable */
import { BaseRepository } from './BaseRepository';
import { api, unwrap } from '../lib/api';

export class BookingRepository extends BaseRepository<any> {
  constructor() {
    super('/bookings');
  }

  async holdSeat(tripId: string, seatNumber: string): Promise<any> {
    const response = await api.post<any>('/trips/' + tripId + '/seat-holds', { seatNumber });
    return unwrap(response);
  }

  async releaseSeat(holdId: string, tripId: string): Promise<any> {
    const response = await api.delete<any>(`/trips/${tripId}/seat-holds/${holdId}`);
    return unwrap(response);
  }

  async finalize(data: { seatHoldId: string; tripId: string; seatNumber: string; pickupStopId?: string; boardingStopId?: string; destinationStopId: string; subscriptionId?: string }, idempotencyKey?: string): Promise<any> {
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
    const response = await api.post('/bookings', data, headers);
    return unwrap(response);
  }

  async cancelBooking(id: string, reason: string) {
    const response = await api.post(`/bookings/${id}/cancel`, { reason });
    return unwrap(response);
  }
}

export const bookingRepository = new BookingRepository();
