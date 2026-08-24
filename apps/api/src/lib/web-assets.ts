import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import express, { type Express } from 'express';
import { env } from '../config/env.js';

export const attachProductionWebAssets = (app: Express): void => {
  if (env.NODE_ENV !== 'production' || !env.SERVE_WEB_ASSETS) return;
  const primaryDirectory = resolve(process.cwd(), env.WEB_DIST_DIR);
  const fallbackDirectory = resolve(process.cwd(), '../..', env.WEB_DIST_DIR);
  const directory = [primaryDirectory, fallbackDirectory].find((candidate) =>
    existsSync(resolve(candidate, 'index.html')),
  ) ?? primaryDirectory;
  const indexFile = resolve(directory, 'index.html');
  if (!existsSync(indexFile)) {
    throw new Error(`Production web build was not found at ${indexFile}`);
  }

  app.use(
    express.static(directory, {
      index: false,
      setHeaders(response, filePath) {
        if (filePath.includes(`${sep}assets${sep}`)) {
          response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('sw.js')) {
          response.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  app.use((request, response, next) => {
    const reservedPath = /^(?:\/api(?:\/|$)|\/health(?:\/|$)|\/socket\.io(?:\/|$))/i.test(request.path);
    if (request.method !== 'GET' || reservedPath || !request.accepts('html')) return next();
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(indexFile);
  });
};
