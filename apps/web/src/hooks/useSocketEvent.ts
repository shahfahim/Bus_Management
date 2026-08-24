import { useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';

export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const { socket } = useSocket();
  useEffect(() => {
    if (!socket) return undefined;
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, [event, handler, socket]);
}
