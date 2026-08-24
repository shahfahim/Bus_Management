import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { randomToken } from '../../lib/security.js';

export interface QrClaims {
  sub: string;
  bookingId: string;
  tripId: string;
  jti: string;
  type: 'bus-entry';
  iat: number;
  exp: number;
}

export const issueQrToken = ({
  userId,
  bookingId,
  tripId,
  expiresAt,
  jti = randomToken(24),
  issuedAt = new Date(),
}: {
  userId: string;
  bookingId: string;
  tripId: string;
  expiresAt: Date;
  jti?: string;
  issuedAt?: Date;
}): { token: string; jti: string } => {
  const issuedAtSeconds = Math.floor(issuedAt.getTime() / 1_000);
  const expiresAtSeconds = Math.floor(expiresAt.getTime() / 1_000);
  if (expiresAtSeconds <= Math.floor(Date.now() / 1_000)) {
    throw new AppError(409, 'TRIP_EXPIRED', 'A QR code cannot be issued for an expired trip');
  }

  const token = jwt.sign(
    { bookingId, tripId, type: 'bus-entry', iat: issuedAtSeconds, exp: expiresAtSeconds },
    env.QR_SIGNING_SECRET,
    {
      algorithm: 'HS256',
      subject: userId,
      jwtid: jti,
      issuer: 'university-bus-api',
      audience: 'bus-check-in',
    },
  );
  return { token, jti };
};

export const verifyQrToken = (token: string): QrClaims => {
  try {
    const decoded = jwt.verify(token, env.QR_SIGNING_SECRET, {
      algorithms: ['HS256'],
      issuer: 'university-bus-api',
      audience: 'bus-check-in',
    });
    if (
      typeof decoded === 'string' ||
      decoded.type !== 'bus-entry' ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.bookingId !== 'string' ||
      typeof decoded.tripId !== 'string' ||
      typeof decoded.jti !== 'string' ||
      typeof decoded.iat !== 'number' ||
      typeof decoded.exp !== 'number'
    ) {
      throw new Error('Invalid QR claims');
    }
    return decoded as unknown as QrClaims;
  } catch {
    throw new AppError(400, 'INVALID_QR', 'The QR code is invalid, altered, or expired');
  }
};
