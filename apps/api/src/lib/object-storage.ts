import { env } from '../config/env.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';

const apiKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(env.SUPABASE_URL && apiKey && env.SUPABASE_STORAGE_BUCKET);

const validateKey = (key: string): string[] => {
  const segments = key.split('/');
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new AppError(400, 'INVALID_OBJECT_KEY', 'The storage object key is invalid');
  }
  return segments;
};

const safeKey = (key: string): string => validateKey(key).map(encodeURIComponent).join('/');

const endpoint = (path: string): string => `${env.SUPABASE_URL!.replace(/\/$/, '')}/storage/v1${path}`;

const authHeaders = (): Record<string, string> => {
  const key = apiKey!;
  return key.startsWith('sb_secret_') ? { apikey: key } : { Authorization: `Bearer ${key}`, apikey: key };
};

const storageFailure = (operation: string, status: number): AppError => {
  logger.error({ operation, status }, 'Supabase Storage operation failed');
  return new AppError(502, 'STORAGE_UNAVAILABLE', 'File storage is temporarily unavailable');
};

export const usesRemoteObjectStorage = (): boolean => configured;

export const putObject = async (key: string, body: Buffer, contentType: string): Promise<void> => {
  if (!configured) throw new AppError(500, 'STORAGE_NOT_CONFIGURED', 'Remote file storage is not configured');
  const response = await fetch(endpoint(`/object/${encodeURIComponent(env.SUPABASE_STORAGE_BUCKET!)}/${safeKey(key)}`), {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': contentType,
      'Cache-Control': '3600',
      'x-upsert': 'false',
    },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(20_000),
  }).catch((error: unknown) => {
    logger.error({ err: error, operation: 'upload' }, 'Supabase Storage request failed');
    throw new AppError(502, 'STORAGE_UNAVAILABLE', 'File storage is temporarily unavailable');
  });
  if (!response.ok) throw storageFailure('upload', response.status);
};

export const removeObjects = async (keys: string[]): Promise<void> => {
  if (!configured || !keys.length) return;
  keys.forEach(validateKey);
  const response = await fetch(endpoint(`/object/${encodeURIComponent(env.SUPABASE_STORAGE_BUCKET!)}`), {
    method: 'DELETE',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: keys }),
    signal: AbortSignal.timeout(20_000),
  }).catch((error: unknown) => {
    logger.error({ err: error, operation: 'delete' }, 'Supabase Storage request failed');
    throw new AppError(502, 'STORAGE_UNAVAILABLE', 'File storage is temporarily unavailable');
  });
  if (!response.ok && response.status !== 404) throw storageFailure('delete', response.status);
};

export const getObject = async (key: string): Promise<{ body: Buffer; contentType: string } | undefined> => {
  if (!configured) return undefined;
  const response = await fetch(
    endpoint(`/object/authenticated/${encodeURIComponent(env.SUPABASE_STORAGE_BUCKET!)}/${safeKey(key)}`),
    { headers: authHeaders(), signal: AbortSignal.timeout(20_000) },
  ).catch((error: unknown) => {
    logger.error({ err: error, operation: 'download' }, 'Supabase Storage request failed');
    throw new AppError(502, 'STORAGE_UNAVAILABLE', 'File storage is temporarily unavailable');
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw storageFailure('download', response.status);
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
};
