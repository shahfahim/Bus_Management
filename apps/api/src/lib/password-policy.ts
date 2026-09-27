import { z } from 'zod';

// Keep in step with apps/web/src/lib/password.ts, which checks the same rule before submitting.
export const PASSWORD_MIN_LENGTH = 6;

/** At least 6 characters with a letter, a number and a special character; letter case does not matter. */
export const strongPassword = () =>
  z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(128)
    .regex(/\p{L}/u, 'Password must include a letter')
    .regex(/\p{N}/u, 'Password must include a number')
    // Marks (\p{M}) are part of letters in scripts such as Bangla, so they do not count as special.
    .regex(/[^\p{L}\p{M}\p{N}\s]/u,'Password must include a special character, such as ! @ # $ or %');
