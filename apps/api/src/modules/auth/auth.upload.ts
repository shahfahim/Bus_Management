import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import multer from 'multer';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { getObject, putObject, removeObjects, usesRemoteObjectStorage } from '../../lib/object-storage.js';

const uploadDirectory = resolve(process.cwd(), env.UPLOAD_DIR, 'verifications');
const acceptedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_MB * 1024 * 1024, files: 1, fields: 30 },
  fileFilter: (_request, file, callback) => {
    callback(null, acceptedMimeTypes.has(file.mimetype));
  },
});

const fields = upload.fields([
  { name: 'document', maxCount: 1 },
]);

export const verificationUpload: RequestHandler = (request, response, next) => {
  fields(request, response, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      return next(new AppError(400, 'INVALID_DOCUMENT_UPLOAD', error.message));
    }
    return next(error);
  });
};

const detectedType = (buffer: Buffer): { mimeType: string; extension: string } | undefined => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: '.jpg' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', extension: '.png' };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp', extension: '.webp' };
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF') {
    return { mimeType: 'application/pdf', extension: '.pdf' };
  }
  return undefined;
};

export const persistVerificationUpload = async (request: Request): Promise<string | undefined> => {
  if (!request.files || Array.isArray(request.files)) return undefined;
  const file = request.files.document?.[0];
  if (!file) return undefined;

  if (!usesRemoteObjectStorage()) await mkdir(uploadDirectory, { recursive: true });
  
  const type = detectedType(file.buffer);
  if (!type || type.mimeType !== file.mimetype) {
    throw new AppError(400, 'INVALID_DOCUMENT_CONTENT', 'Uploaded document content does not match its declared type');
  }
  
  const filename = `${randomUUID()}${type.extension}`;
  
  try {
    if (usesRemoteObjectStorage()) {
      await putObject(`verifications/${filename}`, file.buffer, type.mimeType);
    } else {
      await writeFile(resolve(uploadDirectory, filename), file.buffer, { flag: 'wx' });
    }
    return `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/auth/verifications/${filename}`;
  } catch (error: unknown) {
    throw new AppError(500, 'UPLOAD_FAILED', 'Failed to persist uploaded document');
  }
};

export const sendVerificationDocument: RequestHandler = (request, response, next) => {
  const filename = request.params.filename;
  if (typeof filename !== 'string' || !/^[0-9a-f-]{36}\.(?:jpg|png|webp|pdf)$/.test(filename) || extname(filename).length > 5) {
    return next(new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found'));
  }
  response.setHeader('Cache-Control', 'private, max-age=300');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  
  if (usesRemoteObjectStorage()) {
    void getObject(`verifications/${filename}`)
      .then((object) => {
        if (!object) return next(new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found'));
        response.type(object.contentType).send(object.body);
      })
      .catch(next);
    return;
  }
  response.sendFile(filename, { root: uploadDirectory }, (error) => {
    if (error) next(new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found'));
  });
};
