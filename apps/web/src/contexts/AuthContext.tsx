import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, api, setAccessToken, unwrap } from '../lib/api';
import type { AuthResponse, User } from '../types';

interface LoginInput {
  email: string;
  password: string;
}

interface RegisterInput {
  name: string;
  email: string;
  password: string;
  studentId: string;
  department: string;
  phone?: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<User | null>;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeAuth(payload: AuthResponse | { data: AuthResponse }) {
  return unwrap(payload);
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
    setAccessToken(auth.accessToken);
    setUser(auth.user);
    return auth.user;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const payload = await api.post<AuthResponse | { data: AuthResponse }>('/auth/register', {
      ...input,
      role: 'STUDENT',
    });
    const auth = normalizeAuth(payload);
    setAccessToken(auth.accessToken);
    setUser(auth.user);
    return auth.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken();
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refreshUser, updateUser: setUser }),
    [loading, login, logout, refreshUser, register, user],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
