import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { refreshSession } from '../lib/api';
import { useAuth } from './AuthContext';

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false });

const tripIdOf = (payload: unknown): string | undefined =>
  typeof payload === 'string' ? payload : (payload as { tripId?: unknown } | undefined)?.tripId as string | undefined;

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  // Keyed on the user id, not the user object: saving a profile must not drop the connection.
  useEffect(() => {
    if (!userId) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
      return undefined;
    }

    const socketUrl = import.meta.env.VITE_SOCKET_URL || undefined;
    const socket = io(socketUrl, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 10_000,
    });
    socketRef.current = socket;

    // Remember the trip rooms pages have joined so they are restored after every reconnect.
    const rooms = new Set<string>();
    const emit = socket.emit.bind(socket);
    socket.emit = ((event: string, ...args: unknown[]) => {
      const tripId = tripIdOf(args[0]);
      if (event === 'trip:join' && tripId) rooms.add(tripId);
      if (event === 'trip:leave' && tripId) rooms.delete(tripId);
      return emit(event, ...args);
    }) as typeof socket.emit;

    // The server closes sockets when the short-lived access token expires, and socket.io does not
    // retry a server-side disconnect or an auth rejection on its own: refresh, then reconnect.
    let lastRecovery = 0;
    const recover = () => {
      if (Date.now() - lastRecovery < 15_000) return;
      lastRecovery = Date.now();
      void refreshSession().then((refreshed) => {
        if (refreshed && socketRef.current === socket) socket.connect();
      });
    };
    const onConnect = () => {
      setConnected(true);
      rooms.forEach((tripId) => emit('trip:join', { tripId }));
    };
    const onDisconnect = (reason: string) => {
      setConnected(false);
      if (reason === 'io server disconnect') recover();
    };
    const onConnectError = (error: Error) => {
      if (error.message === 'AUTHENTICATION_REQUIRED') recover();
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [userId]);

  const value = useMemo(() => ({ socket: socketRef.current, connected }), [connected]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}
