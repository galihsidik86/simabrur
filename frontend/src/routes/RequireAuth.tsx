import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { hasRole } from './access';

/** Guard login + (opsional) role. `admin` selalu lolos; role terlarang → redirect ke Dashboard. */
export function RequireAuth({ roles }: { roles?: readonly string[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-2 text-sm">Memuat sesi…</div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (roles && !hasRole(user.role, roles)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
