import { logger } from '../../lib/logger.js';
import { expireBookingHolds } from './booking.service.js';

let timer: NodeJS.Timeout | undefined;

export const startBookingHoldMonitor = (): (() => void) => {
  if (timer) return () => undefined;
  timer = setInterval(() => {
    void expireBookingHolds().catch((error: unknown) => logger.error({ err: error }, 'Booking hold cleanup failed'));
  }, 60_000);
  timer.unref();
  return () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
};
