import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('API application smoke checks', () => {
  const app = createApp();

  it('reports liveness without depending on the database', async () => {
    const response = await request(app).get('/health/live').expect(200);

    expect(response.body).toMatchObject({ status: 'ok' });
    const body = response.body as unknown as { time: string };
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });

  it.each(['/api', '/api/v1'])('publishes API metadata at %s', async (path) => {
    const response = await request(app).get(path).expect(200);

    expect(response.body).toEqual({
      name: 'University Bus Management API',
      version: '1.0.0',
      health: {
        liveness: '/health/live',
        readiness: '/health/ready',
      },
    });
  });

  it('returns the same request id in a not-found response and header', async () => {
    const requestId = 'smoke-test-request-id';
    const response = await request(app).get('/route-that-does-not-exist').set('x-request-id', requestId).expect(404);

    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'No route for GET /route-that-does-not-exist',
        requestId,
      },
    });
  });

  it('rejects a browser origin outside the configured web origin', async () => {
    const response = await request(app)
      .get('/api')
      .set('origin', 'https://attacker.example')
      .set('x-request-id', 'cors-rejection-request-id')
      .expect(403);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.body).toEqual({
      error: {
        code: 'ORIGIN_NOT_ALLOWED',
        message: 'Request origin is not allowed',
        requestId: 'cors-rejection-request-id',
      },
    });
  });
});
