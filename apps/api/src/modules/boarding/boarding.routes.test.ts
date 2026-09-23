import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, errorHandler } from '../../lib/errors.js';

const mocks = vi.hoisted(() => ({ authenticateDoorReader: vi.fn(), checkInWithBoardingCode: vi.fn() }));

vi.mock('./boarding.service.js', async () => {
  const { AppError: BaseError } = await import('../../lib/errors.js');
  class BoardingRejection extends BaseError {
    constructor(statusCode: number, code: string, message: string, public readonly passenger?: unknown) {
      super(statusCode, code, message);
    }
  }
  return {
    BoardingRejection,
    authenticateDoorReader: mocks.authenticateDoorReader,
    checkInWithBoardingCode: mocks.checkInWithBoardingCode,
    getBoardingCard: vi.fn(),
    reissueBoardingCard: vi.fn(),
  };
});
vi.mock('../auth/auth.middleware.js', () => ({ requireAuth: vi.fn(), requireRole: vi.fn(() => vi.fn()) }));

import { BoardingRejection } from './boarding.service.js';
import { boardingRouter } from './boarding.routes.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/api/boarding', boardingRouter);
app.use(errorHandler);

describe('door reader endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateDoorReader.mockResolvedValue({ doorReaderId: 'reader-1', busId: 'bus-1' });
  });

  it('accepts a plain-text scan and returns the rider', async () => {
    mocks.checkInWithBoardingCode.mockResolvedValue({ accepted: true, message: 'Welcome, Nadia · seat 7' });

    const response = await request(app)
      .post('/api/boarding/check-ins')
      .set('X-Door-Reader-Key', 'drk_test')
      .set('Content-Type', 'text/plain')
      .send('UR0123456789ABCDEF0123');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ accepted: true, message: 'Welcome, Nadia · seat 7' });
    expect(mocks.checkInWithBoardingCode).toHaveBeenCalledWith('UR0123456789ABCDEF0123', { doorReaderId: 'reader-1', busId: 'bus-1' });
  });

  it('answers a refused scan with a flat body the device can act on', async () => {
    mocks.checkInWithBoardingCode.mockRejectedValue(new BoardingRejection(409, 'NO_BOOKING', 'No paid booking for this bus'));

    const response = await request(app).post('/api/boarding/check-ins').set('X-Door-Reader-Key', 'drk_test').send({ code: 'UR0123456789ABCDEF0123' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ accepted: false, code: 'NO_BOOKING', message: 'No paid booking for this bus' });
  });

  it('rejects requests without a valid reader key', async () => {
    mocks.authenticateDoorReader.mockRejectedValue(new AppError(401, 'READER_KEY_REQUIRED', 'A door reader key is required'));

    const response = await request(app).post('/api/boarding/check-ins').send({ code: 'UR0123456789ABCDEF0123' });

    expect(response.status).toBe(401);
    expect(mocks.checkInWithBoardingCode).not.toHaveBeenCalled();
  });
});
