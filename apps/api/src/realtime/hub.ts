import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { BookingStatus, Role, UserStatus } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../modules/auth/auth.tokens.js';

interface ServerEvents {
  'trip:location': (payload: unknown) => void;
  'trip:seats': (payload: unknown) => void;
  'trip:status': (payload: unknown) => void;
  'notification:new': (payload: unknown) => void;
  'booking:updated': (payload: unknown) => void;
  'check-in:new': (payload: unknown) => void;
  'trip:updated': (payload: unknown) => void;
  'checkin:created': (payload: unknown) => void;
  'notifications:read': (payload: unknown) => void;
}

interface ClientEvents {
  'trip:join': (trip: string | { tripId: string }, acknowledge?: (result: { ok: boolean }) => void) => void;
  'trip:leave': (trip: string | { tripId: string }) => void;
}

interface SocketData {
  userId: string;
  role: Role;
  sessionId: string;
  expiresAt?: number;
}

let io: Server<ClientEvents, ServerEvents, object, SocketData> | undefined;

const tokenFromCookie = (header: string | undefined): string | undefined => {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === 'access_token') return decodeURIComponent(value.join('='));
  }
  return undefined;
};

export const initializeRealtime = (httpServer: HttpServer) => {
  io = new Server<ClientEvents, ServerEvents, object, SocketData>(httpServer, {
    cors: { origin: env.WEB_ORIGIN, credentials: true },
    transports: ['websocket', 'polling'],
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  io.use(async (socket, next) => {
    try {
      const authorization = socket.handshake.headers.authorization;
      const bearer = authorization?.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : undefined;
      const authToken = typeof socket.handshake.auth.token === 'string' ? socket.handshake.auth.token : undefined;
      const claims = verifyAccessToken(authToken ?? bearer ?? tokenFromCookie(socket.handshake.headers.cookie) ?? '');
      const session = await prisma.session.findFirst({
        where: {
          id: claims.sid,
          userId: claims.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { status: UserStatus.ACTIVE, deletedAt: null },
        },
        select: { user: { select: { role: true, passwordChangedAt: true } } },
      });
      if (!session || session.user.role !== claims.role) {
        throw new Error('SESSION_REVOKED');
      }
      socket.data = {
        userId: claims.sub,
        role: session.user.role,
        sessionId: claims.sid,
        expiresAt: claims.exp ? claims.exp * 1_000 : undefined,
      };
      next();
    } catch {
      next(new Error('AUTHENTICATION_REQUIRED'));
    }
  });

  io.on('connection', (socket) => {
    void socket.join(`user:${socket.data.userId}`);
    void socket.join(`role:${socket.data.role}`);
    const expiryTimer = socket.data.expiresAt
      ? setTimeout(() => socket.disconnect(true), Math.max(0, socket.data.expiresAt - Date.now() + 250))
      : undefined;
    socket.once('disconnect', () => {
      if (expiryTimer) clearTimeout(expiryTimer);
    });

    socket.on('trip:join', (trip, acknowledge) => {
      const tripId = typeof trip === 'string' ? trip : trip?.tripId;
      if (
        typeof tripId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tripId)
      ) {
        acknowledge?.({ ok: false });
        return;
      }
      void canJoinTrip(socket.data, tripId)
        .then(async (allowed) => {
          if (!allowed) {
            acknowledge?.({ ok: false });
            return;
          }
          await socket.join(`trip:${tripId}`);
          acknowledge?.({ ok: true });
        })
        .catch(() => acknowledge?.({ ok: false }));
    });
    socket.on('trip:leave', (trip) => {
      const tripId = typeof trip === 'string' ? trip : trip?.tripId;
      if (typeof tripId === 'string') void socket.leave(`trip:${tripId}`);
    });
  });

  logger.info('Real-time gateway initialized');
  return io;
};

export const realtime = () => {
  if (!io) throw new Error('Real-time gateway has not been initialized');
  return io;
};

export const emitToUser = (userId: string, event: keyof ServerEvents, payload: unknown): void => {
  if (io) io.to(`user:${userId}`).emit(event, payload);
};

export const emitToTrip = (tripId: string, event: keyof ServerEvents, payload: unknown): void => {
  if (!io) return;
  io.to(`trip:${tripId}`).emit(event, payload);
  if (event === 'trip:status') io.to(`trip:${tripId}`).emit('trip:updated', payload);
  if (event === 'check-in:new') io.to(`trip:${tripId}`).emit('checkin:created', payload);
};

export const emitToRole = (role: Role, event: keyof ServerEvents, payload: unknown): void => {
  if (io) io.to(`role:${role}`).emit(event, payload);
};

export const disconnectUserSockets = (userId: string): void => {
  if (io) io.in(`user:${userId}`).disconnectSockets(true);
};

export const disconnectSessionSockets = (sessionId: string): void => {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.sessionId === sessionId) socket.disconnect(true);
  }
};

const canJoinTrip = async (actor: SocketData, tripId: string): Promise<boolean> => {
  if (actor.role === Role.ADMIN) return true;
  if (actor.role === Role.DRIVER || actor.role === Role.CONDUCTOR) {
    return (
      (await prisma.trip.count({
        where: {
          id: tripId,
          ...(actor.role === Role.DRIVER ? { driverId: actor.userId } : { conductorId: actor.userId }),
        },
      })) === 1
    );
  }
  return (
    (await prisma.booking.count({
      where: {
        tripId,
        studentId: actor.userId,
        status: {
          in: [BookingStatus.HELD, BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN],
        },
      },
    })) === 1
  );
};
