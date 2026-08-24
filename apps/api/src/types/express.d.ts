import type { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: Role;
        sessionId: string;
      };
    }
  }
}

export {};
