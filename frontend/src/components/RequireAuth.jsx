import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

/**
 * Route guard. Wraps the protected routes; redirects to /login when no
 * session cookie exists. Renders a "Checking session…" placeholder while
 * the initial /users/me probe is in flight so we don't flash a redirect.
 */
export default function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b0b0f] text-white">
        <p className="text-sm text-white/40">Checking session…</p>
      </div>
    )
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return <Outlet />
}
