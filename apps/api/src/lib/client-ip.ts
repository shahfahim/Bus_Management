import { isIP } from 'node:net';
import type { RequestHandler } from 'express';

/**
 * Behind Render's edge, request.ip is an internal proxy address shared by every visitor, which
 * makes per-address rate limits global and records useless addresses. When the deployment sits
 * behind an edge that sets a trustworthy client-address header (Cloudflare's CF-Connecting-IP,
 * which visitors cannot forge through Cloudflare), use it. Only enable this where every request
 * really passes through that edge; otherwise the header could be supplied by the client.
 */
export const clientIpFromHeader = (headerName: string | undefined): RequestHandler => (request, _response, next) => {
  if (headerName) {
    const value = request.get(headerName)?.trim();
    if (value && isIP(value)) Object.defineProperty(request, 'ip', { value, configurable: true, enumerable: true });
  }
  next();
};
