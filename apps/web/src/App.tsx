import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Brand } from './components/Brand';
import { ProtectedRoute } from './components/ProtectedRoute';
import type { Role } from './types';

const AuthPage = lazy(() => import('./pages/AuthPage').then((module) => ({ default: module.AuthPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })));
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage').then((module) => ({ default: module.ChangePasswordPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })));
const RoutesPage = lazy(() => import('./pages/student/RoutesPage').then((module) => ({ default: module.RoutesPage })));
const BookTripPage = lazy(() => import('./pages/student/BookTripPage').then((module) => ({ default: module.BookTripPage })));
const BookingsPage = lazy(() => import('./pages/student/BookingsPage').then((module) => ({ default: module.BookingsPage })));
const BookingDetailPage = lazy(() => import('./pages/student/BookingDetailPage').then((module) => ({ default: module.BookingDetailPage })));
const PaymentsPage = lazy(() => import('./pages/student/PaymentsPage').then((module) => ({ default: module.PaymentsPage })));
const SubscriptionsPage = lazy(() => import('./pages/student/SubscriptionsPage').then((module) => ({ default: module.SubscriptionsPage })));
const RatingsPage = lazy(() => import('./pages/student/RatingsPage').then((module) => ({ default: module.RatingsPage })));
const NotificationsPage = lazy(() => import('./pages/shared/NotificationsPage').then((module) => ({ default: module.NotificationsPage })));
const LostFoundPage = lazy(() => import('./pages/shared/LostFoundPage').then((module) => ({ default: module.LostFoundPage })));
const DriverTripsPage = lazy(() => import('./pages/driver/DriverTripsPage').then((module) => ({ default: module.DriverTripsPage })));
const CreateDriverTripPage = lazy(() => import('./pages/driver/CreateDriverTripPage').then((module) => ({ default: module.CreateDriverTripPage })));
const DriverTripDetailPage = lazy(() => import('./pages/driver/DriverTripDetailPage').then((module) => ({ default: module.DriverTripDetailPage })));
const QrScannerPage = lazy(() => import('./pages/driver/QrScannerPage').then((module) => ({ default: module.QrScannerPage })));
const IncidentPage = lazy(() => import('./pages/driver/IncidentPage').then((module) => ({ default: module.IncidentPage })));
const AdminWorkspacePage = lazy(() => import('./pages/admin/AdminWorkspacePage').then((module) => ({ default: module.AdminWorkspacePage })));

function RoleGuard({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  return <ProtectedRoute roles={roles}>{children}</ProtectedRoute>;
}

function PageLoader() {
  return <div aria-live="polite" className="route-loading" role="status"><span className="loading-orbit" /><span>Loading workspace…</span></div>;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<AuthPage initialMode="login" />} path="/login" />
        <Route element={<AuthPage initialMode="register" />} path="/register" />
        <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
          <Route element={<Navigate replace to="/dashboard" />} index />
          <Route element={<DashboardPage />} path="dashboard" />
          <Route element={<ProfilePage />} path="profile" />
          <Route element={<ChangePasswordPage />} path="change-password" />
          <Route element={<NotificationsPage />} path="notifications" />
          <Route element={<LostFoundPage />} path="lost-found" />

          <Route element={<RoleGuard roles={['STUDENT']}><RoutesPage /></RoleGuard>} path="student/routes" />
          <Route element={<RoleGuard roles={['STUDENT']}><BookTripPage /></RoleGuard>} path="student/trips/:tripId/book" />
          <Route element={<RoleGuard roles={['STUDENT']}><BookingsPage /></RoleGuard>} path="student/bookings" />
          <Route element={<RoleGuard roles={['STUDENT']}><BookingDetailPage /></RoleGuard>} path="student/bookings/:bookingId" />
          <Route element={<RoleGuard roles={['STUDENT']}><PaymentsPage /></RoleGuard>} path="student/payments" />
          <Route element={<RoleGuard roles={['STUDENT']}><SubscriptionsPage /></RoleGuard>} path="student/subscriptions" />
          <Route element={<RoleGuard roles={['STUDENT']}><RatingsPage /></RoleGuard>} path="student/ratings" />

          <Route element={<RoleGuard roles={['DRIVER', 'CONDUCTOR']}><DriverTripsPage /></RoleGuard>} path="driver/trips" />
          <Route element={<RoleGuard roles={['DRIVER']}><CreateDriverTripPage /></RoleGuard>} path="driver/trips/new" />
          <Route element={<RoleGuard roles={['DRIVER', 'CONDUCTOR']}><DriverTripDetailPage /></RoleGuard>} path="driver/trips/:tripId" />
          <Route element={<RoleGuard roles={['DRIVER', 'CONDUCTOR']}><QrScannerPage /></RoleGuard>} path="driver/check-in" />
          <Route element={<RoleGuard roles={['DRIVER']}><IncidentPage /></RoleGuard>} path="driver/incidents" />

          <Route element={<RoleGuard roles={['ADMIN']}><Navigate replace to="/admin/overview" /></RoleGuard>} path="admin" />
          <Route element={<RoleGuard roles={['ADMIN']}><AdminWorkspacePage /></RoleGuard>} path="admin/:section" />
        </Route>
        <Route element={<NotFoundPage />} path="*" />
      </Routes>
    </Suspense>
  );
}

export function BootLoader() {
  return <div className="app-loading"><Brand /><span className="loading-orbit" /><p>Starting UniRide…</p></div>;
}
