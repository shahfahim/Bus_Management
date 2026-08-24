import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';

describe('admin route security', () => {
  const app = createApp();

  it.each(['/api/admin/overview', '/api/v1/admin/buses', '/api/admin/incidents'])('requires authentication for %s', async (path) => {
    const response = await request(app).get(path).expect(401);
    expect(response.body).toMatchObject({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
      },
    });
  });
});
