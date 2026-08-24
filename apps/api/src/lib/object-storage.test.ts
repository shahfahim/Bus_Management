import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnvironment = { ...process.env };

const loadConfiguredStorage = async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test-key-with-safe-length';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_STORAGE_BUCKET = 'bus-uploads';
  vi.resetModules();
  return import('./object-storage.js');
};

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('Supabase object storage adapter', () => {
  it('uploads to a private bucket without exposing an unauthenticated URL', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', request);
    const storage = await loadConfiguredStorage();

    await storage.putObject('lost-found/item photo.png', Buffer.from('image'), 'image/png');

    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://project.supabase.co/storage/v1/object/bus-uploads/lost-found/item%20photo.png');
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({
      apikey: 'sb_secret_test-key-with-safe-length',
      'Content-Type': 'image/png',
      'x-upsert': 'false',
    });
    expect(options.headers).not.toHaveProperty('Authorization');
  });

  it('downloads private objects through the authenticated endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/webp' } }),
      ),
    );
    const storage = await loadConfiguredStorage();

    const object = await storage.getObject('incidents/evidence.webp');

    expect(object?.contentType).toBe('image/webp');
    expect(object?.body).toEqual(Buffer.from([1, 2, 3]));
  });

  it('rejects unsafe object keys before making a request', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const storage = await loadConfiguredStorage();

    await expect(storage.putObject('../secret.png', Buffer.from('image'), 'image/png')).rejects.toMatchObject({
      code: 'INVALID_OBJECT_KEY',
    });
    expect(request).not.toHaveBeenCalled();
  });
});
