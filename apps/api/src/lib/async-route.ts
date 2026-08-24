import type { RequestHandler } from 'express';

export const asyncRoute = (handler: RequestHandler): RequestHandler => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};
