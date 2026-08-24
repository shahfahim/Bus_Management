import { logger } from '../../lib/logger.js';
import { reconcileMaintenanceStatuses } from './maintenance.service.js';

export const startMaintenanceMonitor = (intervalMs = 30_000): (() => void) => {
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await reconcileMaintenanceStatuses();
    } catch (error: unknown) {
      logger.error({ err: error }, 'Maintenance status reconciliation failed');
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
};
