import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, api, setAccessToken, unwrap } from '../lib/api';
import { clearPersonalApiCache } from '../lib/offline-cache';
import type { AuthResponse, User } from '../types';

interface LoginInput {
  email: string;
  password: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<User | null>;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeAuth(payload: AuthResponse | { data: AuthResponse }) {
  return unwrap(payload);
}

// Stop this browser receiving the signed-out user's push alerts (and free it for the next user).
async function removePushSubscription() {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await api.delete('/notifications/push/subscriptions', { endpoint: subscription.endpoint }).catch(() => undefined);
    await subscription.unsubscribe();
  } catch {
    // Push cleanup is best effort and must never block signing out.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const payload = await api.get<User | { data: User }>('/auth/me');
      const nextUser = unwrap(payload);
      setUser(nextUser);
      return nextUser;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAccessToken();
        clearPersonalApiCache();
        setUser(null);
        return null;
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    refreshUser()
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (input: LoginInput) => {
    const payload = await api.post<AuthResponse | { data: AuthResponse }>('/auth/login', input);
    const auth = normalizeAuth(payload);
    setAccessToken();
    clearPersonalApiCache();
    setUser(auth.user);
    return auth.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await removePushSubscription();
      await api.post('/auth/logout');
    } finally {
      setAccessToken();
      clearPersonalApiCache();
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refreshUser, updateUser: setUser }),
    [loading, login, logout, refreshUser, user],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
