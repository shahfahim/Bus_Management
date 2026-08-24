import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { Role } from '../types';
import { Brand } from './Brand';

export function ProtectedRoute({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div aria-live="polite" className="app-loading" role="status">
        <Brand />
        <span className="loading-orbit" />
        <p>Preparing your journey…</p>
      </div>
    );
  }
  if (!user) return <Navigate replace state={{ from: location }} to="/login" />;
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate replace to="/change-password" />;
  }
  if (roles && !roles.includes(user.role)) return <Navigate replace to="/dashboard" />;
  return children;
}
