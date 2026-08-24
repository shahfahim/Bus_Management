import { z } from 'zod';

export const scanQrSchema = z.object({
  token: z.string().trim().min(50).max(4_000),
  tripId: z.string().trim().min(5).max(100).optional(),
  scannerDeviceId: z.string().trim().min(2).max(100).optional(),
});
