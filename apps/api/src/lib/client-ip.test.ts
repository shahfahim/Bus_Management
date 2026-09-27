import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { clientIpFromHeader } from './client-ip.js';

const appWith = (headerName: string | undefined) => {
  const app = express();
  app.use(clientIpFromHeader(headerName));
  app.get('/', (req, res) => res.json({ ip: req.ip }));
  return app;
};

describe('client address resolution', () => {
  it('uses the configured edge header when it holds a valid address', async () => {
    const response = await request(appWith('cf-connecting-ip')).get('/').set('CF-Connecting-IP', '203.0.113.7');
    expect(response.body).toEqual({ ip: '203.0.113.7' });
  });

  it('ignores a malformed header value', async () => {
    const response = await request(appWith('cf-connecting-ip')).get('/').set('CF-Connecting-IP', '203.0.113.7, 10.0.0.1');
    expect((response.body as { ip: string }).ip).not.toBe('203.0.113.7, 10.0.0.1');
  });

  it('leaves the address alone when no header is configured', async () => {
    const response = await request(appWith(undefined)).get('/').set('CF-Connecting-IP', '203.0.113.7');
    expect((response.body as { ip: string }).ip).not.toBe('203.0.113.7');
  });
});
