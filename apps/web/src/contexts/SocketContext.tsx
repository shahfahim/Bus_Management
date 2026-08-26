import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false });

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user) {
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
    const connect = () => setConnected(true);
    const disconnect = () => setConnected(false);
    socket.on('connect', connect);
    socket.on('disconnect', disconnect);
    return () => {
      socket.off('connect', connect);
      socket.off('disconnect', disconnect);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user]);

  const value = useMemo(() => ({ socket: socketRef.current, connected }), [connected]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}
