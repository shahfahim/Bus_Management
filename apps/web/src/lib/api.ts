const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const ACCESS_TOKEN_KEY = 'uniride.access-token';

type Primitive = string | number | boolean | null | undefined;
type QueryValue = Primitive | Primitive[];

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getAccessToken() {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(token?: string) {
  if (token) sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
  else sessionStorage.removeItem(ACCESS_TOKEN_KEY);
}

export function withQuery(path: string, query: Record<string, QueryValue>) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, rawValue]) => {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    values.forEach((value) => {
      if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
    });
  });
  const suffix = params.toString();
  return suffix ? `${path}${path.includes('?') ? '&' : '?'}${suffix}` : path;
}

function createHeaders(body?: unknown, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set('Accept', 'application/json');
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
  return headers;
}

async function parseResponse(response: Response) {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return response.json() as Promise<unknown>;
  return response.text();
}

let refreshRequest: Promise<boolean> | null = null;

async function refreshSession() {
  if (!refreshRequest) {
    refreshRequest = fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) return false;
        const body = (await parseResponse(response)) as { accessToken?: string; data?: { accessToken?: string } } | undefined;
        setAccessToken(body?.accessToken ?? body?.data?.accessToken);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshRequest = null;
      });
  }
  return refreshRequest;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const body = init.body;
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: createHeaders(body, init.headers),
    body: body instanceof FormData || typeof body === 'string' || body === undefined ? body : JSON.stringify(body),
  });

  const doesNotUseRefresh = ['/auth/login', '/auth/register', '/auth/refresh'].some(
    (endpoint) => path === endpoint || path.startsWith(`${endpoint}?`),
  );
  if (response.status === 401 && retry && !doesNotUseRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, init, false);
  }

  const parsed = await parseResponse(response);
  if (!response.ok) {
    const problem = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
    const nested = problem?.error && typeof problem.error === 'object' ? (problem.error as Record<string, unknown>) : undefined;
    const message = String(nested?.message ?? problem?.message ?? parsed ?? `Request failed (${response.status})`);
    throw new ApiError(message, response.status, String(nested?.code ?? problem?.code ?? ''), nested?.details ?? problem?.details);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown, headers?: HeadersInit) => request<T>(path, { method: 'POST', body: body as BodyInit, headers }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body as BodyInit }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body as BodyInit }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body: body as BodyInit }),
};

export function unwrap<T>(payload: T | { data: T }): T {
  return payload && typeof payload === 'object' && 'data' in payload ? (payload as { data: T }).data : (payload as T);
}

export function asItems<T>(payload: unknown): T[] {
  const value = unwrap(payload as unknown | { data: unknown });
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['items', 'results', 'rows']) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  return [];
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.') {
  return error instanceof Error && error.message ? error.message : fallback;
}
