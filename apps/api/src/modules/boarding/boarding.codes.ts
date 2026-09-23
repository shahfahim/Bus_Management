import { randomBytes } from 'node:crypto';

/**
 * Personal boarding codes: "UR" followed by 20 upper-case hex digits (80 random bits).
 * The code only identifies the student; the trip, stops and seat always come from the
 * booking in the database at scan time, so one code works for every future booking.
 * Plain ASCII keeps it readable by any Code 128 scanner.
 */
export const BOARDING_CODE_PATTERN = /^UR[0-9A-F]{20}$/;

export const generateBoardingCode = (): string => `UR${randomBytes(10).toString('hex').toUpperCase()}`;

/** Accepts what a reader or a person typed (spaces, dashes, lower case) and returns the canonical code. */
export const normalizeBoardingCode = (input: string): string | undefined => {
  const compact = input.replace(/[\s-]/g, '').toUpperCase();
  return BOARDING_CODE_PATTERN.test(compact) ? compact : undefined;
};

/** Door reader API keys: shown once on creation, stored only as a SHA-256 hash. */
export const generateDoorReaderKey = (): string => `drk_${randomBytes(24).toString('base64url')}`;
