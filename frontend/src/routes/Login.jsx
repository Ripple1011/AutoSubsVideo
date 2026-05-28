import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

/**
 * Single "Continue with Google" button. Hits /auth/google/authorize to get
 * the redirect URL, then sends the browser there. Google does its consent
 * dance and bounces back to /auth/google/callback on the backend, which
 * sets the session cookie and 302s to oauth_success_redirect (configured
 * in backend config — defaults to /projects).
 *
 * If the user is already logged in, this route bounces them straight to
 * the destination they were trying to reach (or /projects).
 */
export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, loading } = useAuth()
  const [error, setError] = useState(null)
  const [working, setWorking] = useState(false)

  const next = location.state?.from || '/projects'

  // Already logged in? Bounce out.
  useEffect(() => {
    if (!loading && user) navigate(next, { replace: true })
  }, [user, loading, next, navigate])

  const handleGoogle = async () => {
    setWorking(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/google/authorize', { credentials: 'include' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || `Authorize failed (${res.status})`)
      }
      const data = await res.json()
      if (!data.authorization_url) throw new Error('No authorization URL returned from server.')
      // Full-page redirect — Google needs to set its own cookies and we
      // need to come back to the backend's /auth/google/callback.
      window.location.href = data.authorization_url
    } catch (e) {
      setError(e.message)
      setWorking(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-white/40">Checking session…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">AutoSub</h1>
          <p className="text-sm text-white/50 mt-2">
            Sign in to manage your subtitle projects.
          </p>
        </div>

        <button
          onClick={handleGoogle}
          disabled={working}
          className="w-full px-4 py-3 rounded-full bg-white text-[#0b0b0f] font-semibold hover:bg-white/90 disabled:bg-white/40 flex items-center justify-center gap-3"
        >
          <GoogleGlyph />
          {working ? 'Redirecting to Google…' : 'Continue with Google'}
        </button>

        {error && (
          <div className="text-xs rounded px-3 py-2 bg-rose-500/20 text-rose-200">
            {error}
          </div>
        )}

        <p className="text-[11px] text-white/30">
          We use Google sign-in to verify your email. We don't store passwords
          and we don't post anything to your Google account.
        </p>
      </div>
    </div>
  )
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  )
}
