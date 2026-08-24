import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Request, RequestHandler } from 'express';
import multer from 'multer';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

const directory = resolve(process.cwd(), env.UPLOAD_DIR, 'incidents');
const accepted = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 30 },
  fileFilter: (_request, file, callback) => callback(null, accepted.has(file.mimetype)),
}).single('image');

export const incidentUpload: RequestHandler = (request, response, next) => {
  upload(request, response, (error: unknown) => {
    if (error instanceof multer.MulterError) return next(new AppError(400, 'INVALID_IMAGE_UPLOAD', error.message));
    next(error);
  });
};

const detect = (buffer: Buffer): { mimeType: string; extension: string } | undefined => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: '.jpg' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', extension: '.png' };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp', extension: '.webp' };
  }
  return undefined;
};

export interface StoredIncidentImage {
  filename: string;
  url: string;
  mediaType: string;
}

export const persistIncidentUpload = async (request: Request): Promise<StoredIncidentImage | undefined> => {
  if (!request.file) return undefined;
  const detected = detect(request.file.buffer);
  if (!detected || detected.mimeType !== request.file.mimetype) {
    throw new AppError(400, 'INVALID_IMAGE_CONTENT', 'Uploaded image content does not match its declared type');
  }
  await mkdir(directory, { recursive: true });
  const filename = `${randomUUID()}${detected.extension}`;
  await writeFile(resolve(directory, filename), request.file.buffer, { flag: 'wx' });
  return {
    filename,
    mediaType: detected.mimeType,
    url: `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/driver/incidents/images/${filename}`,
  };
};

export const removeIncidentUpload = async (image: StoredIncidentImage | undefined): Promise<void> => {
  if (image) await rm(resolve(directory, image.filename), { force: true });
};

export const sendIncidentImage: RequestHandler = (request, response, next) => {
  const filename = request.params.filename;
  if (typeof filename !== 'string' || !/^[0-9a-f-]{36}\.(?:jpg|png|webp)$/.test(filename)) {
    return next(new AppError(404, 'IMAGE_NOT_FOUND', 'Image not found'));
  }
  response.setHeader('Cache-Control', 'private, max-age=3600');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.sendFile(filename, { root: directory }, (error) => {
    if (error) next(new AppError(404, 'IMAGE_NOT_FOUND', 'Image not found'));
  });
};
