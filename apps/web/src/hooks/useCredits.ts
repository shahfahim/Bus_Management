import { useCallback, useEffect, useState } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { api, errorMessage, unwrap, withQuery } from '../lib/api';
import type { CreditWallet } from '../types';

/** The signed-in student's credit balance and recent ledger, kept current over the socket. */
export function useCredits(pageSize = 5) {
  const { socket } = useSocket();
  const [wallet, setWallet] = useState<CreditWallet>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setError('');
    try {
      setWallet(unwrap(await api.get<CreditWallet | { data: CreditWallet }>(withQuery('/credits', { pageSize }))));
    } catch (reason) {
      setError(errorMessage(reason, 'Could not load your credit balance.'));
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  useEffect(() => { void reload(); }, [reload]);

  // Top-ups, fares, pass purchases and refunds all change the balance on the server.
  useEffect(() => {
    if (!socket) return undefined;
    const onChange = () => void reload();
    socket.on('credits:updated', onChange);
    socket.on('booking:updated', onChange);
    return () => {
      socket.off('credits:updated', onChange);
      socket.off('booking:updated', onChange);
    };
  }, [socket, reload]);

  return { wallet, balance: wallet?.balance, loading, error, reload };
}

export const formatCredits = (value = 0) =>
  `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${Math.abs(value) === 1 ? 'credit' : 'credits'}`;
