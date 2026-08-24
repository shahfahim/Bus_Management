import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/errors.js';
import { issueQrToken, verifyQrToken } from './qr.tokens.js';

describe('booking QR tokens', () => {
  it('binds the signed token to its user, booking and trip', () => {
    const { token, jti } = issueQrToken({
      userId: 'student-1',
      bookingId: 'booking-1',
      tripId: 'trip-1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const claims = verifyQrToken(token);

    expect(claims.sub).toBe('student-1');
    expect(claims.bookingId).toBe('booking-1');
    expect(claims.tripId).toBe('trip-1');
    expect(claims.jti).toBe(jti);
  });

  it('rejects an altered token', () => {
    const { token } = issueQrToken({
      userId: 'student-1',
      bookingId: 'booking-1',
      tripId: 'trip-1',
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(() => verifyQrToken(`${token.slice(0, -2)}xx`)).toThrow(AppError);
  });

  it('does not issue already-expired credentials', () => {
    expect(() =>
      issueQrToken({
        userId: 'student-1',
        bookingId: 'booking-1',
        tripId: 'trip-1',
        expiresAt: new Date(Date.now() - 1),
      }),
    ).toThrowError(/expired trip/);
  });
});
