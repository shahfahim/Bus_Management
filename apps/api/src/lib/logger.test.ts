import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

describe('logger redaction', () => {
  it('redacts authentication cookies from response headers', () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
        callback();
      },
    });
    const logger = createLogger(destination);

    logger.info({ res: { headers: { 'set-cookie': ['dummy-sensitive-cookie'] } } }, 'redaction test');

    const output = chunks.join('');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('dummy-sensitive-cookie');
  });
});
