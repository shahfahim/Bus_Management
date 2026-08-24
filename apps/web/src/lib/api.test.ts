import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, asItems, setAccessToken, withQuery } from './api';

describe('API client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setAccessToken();
  });

  it('serializes filters and repeated array parameters', () => {
    expect(withQuery('/trips', { date: '2026-08-21', status: ['SCHEDULED', 'DELAYED'], empty: '', page: 2 })).toBe(
      '/trips?date=2026-08-21&status=SCHEDULED&status=DELAYED&page=2',
    );
  });

  it('normalizes common paginated response envelopes', () => {
    expect(asItems<{ id: string }>({ data: { items: [{ id: 'trip-1' }], total: 1 } })).toEqual([{ id: 'trip-1' }]);
    expect(asItems<{ id: string }>({ results: [{ id: 'trip-2' }] })).toEqual([{ id: 'trip-2' }]);
  });

  it('sends credentials and the short-lived bearer token', async () => {
    setAccessToken('test-access-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await api.get('/health');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-access-token');
  });
});
