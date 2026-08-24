import { z } from 'zod';

export const strongPassword = (minimumLength = 10) =>
  z
    .string()
    .min(minimumLength)
    .max(128)
    .regex(/[a-z]/, 'Password must include a lowercase letter')
    .regex(/[A-Z]/, 'Password must include an uppercase letter')
    .regex(/[0-9]/, 'Password must include a number');
