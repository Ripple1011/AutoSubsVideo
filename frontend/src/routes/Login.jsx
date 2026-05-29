import { useEffect, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { BRAND, COLORS, GRADIENTS, LOGO, CTA } from '../lib/brand'

/**
 * Single "Continue with Google" button. Hits /auth/google/authorize to get
 * the redirect URL, then sends the browser there. Google does its consent
 * dance and bounces back to /auth/google/callback on the backend, which
 * sets the session cookie and 302s to oauth_success_redirect (configured
 * in backend config — defaults to /projects).
 *
 * If the user is already logged in, this route bounces them straight to
 * the destination they were trying to reach (or /projects).
 *
 * Layout mirrors the public chrome: same top nav and footer as the landing
 * page, so a visitor mid-acquisition doesn't feel like they've left the
 * site. The login card itself is a single shadowed surface centered in
 * the available height — Google-style: one CTA, one decision, no clutter.
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

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800 font-[Inter]">
      <LoginTopNav />

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 sm:p-10">
            <h1
              className="text-2xl font-bold text-center tracking-tight"
              style={{ color: COLORS.dark }}
            >
              Welcome back
            </h1>
            <p className="text-sm text-slate-500 text-center mt-2">
              Sign in to keep your projects, credits, and exports in one place.
            </p>

            {loading ? (
              <div className="mt-8 flex justify-center">
                <p className="text-sm text-slate-400">Checking session…</p>
              </div>
            ) : (
              <button
                onClick={handleGoogle}
                disabled={working}
                className="mt-8 w-full px-4 py-3 rounded-full bg-white border border-slate-300 text-slate-800 font-semibold hover:bg-slate-50 hover:border-slate-400 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-sm transition-colors"
              >
                <GoogleGlyph />
                {working ? 'Redirecting to Google…' : CTA.signinSecondary}
              </button>
            )}

            {error && (
              <div className="mt-4 text-xs rounded px-3 py-2 bg-rose-50 border border-rose-200 text-rose-700">
                {error}
              </div>
            )}

            <div className="mt-6 flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                What you get
              </span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            <p
              className="mt-5 text-sm text-center font-semibold"
              style={{ color: COLORS.gradientTo }}
            >
              🪙 3 free videos on signup · no credit card required
            </p>

            <p className="mt-6 text-[11px] text-slate-400 text-center leading-relaxed">
              By continuing you agree to our{' '}
              <Link to="/terms" className="underline hover:text-slate-700">Terms</Link>{' '}
              and{' '}
              <Link to="/privacy" className="underline hover:text-slate-700">Privacy Policy</Link>.
            </p>
          </div>
        </div>
      </main>

      <LoginFooter />
    </div>
  )
}

/**
 * Top nav for the logged-out auth flow. Matches the landing page's TopNav
 * but drops the "Sign in" button (we're already on it) and replaces it
 * with a "← Back to home" link so users can bounce out of the funnel.
 */
function LoginTopNav() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center" title={BRAND.name}>
          <img src={LOGO.full} alt={BRAND.name} className="h-14 w-auto" />
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link to="/pricing" className="text-slate-600 hover:text-slate-900 font-medium">
            Pricing
          </Link>
          <Link to="/" className="text-slate-500 hover:text-slate-900 font-medium">
            ← Home
          </Link>
        </nav>
      </div>
    </header>
  )
}

/**
 * Slim footer matching the public chrome on Landing and Pricing — Privacy /
 * Terms / Support links + copyright. Keeping the surface consistent with the
 * landing page so users don't feel like they've left the site.
 */
function LoginFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-3">
        <div>© {BRAND.copyrightYear} {BRAND.name} · by {BRAND.parent}</div>
        <div className="flex gap-4">
          <Link to="/privacy" className="hover:text-slate-900">Privacy</Link>
          <Link to="/terms" className="hover:text-slate-900">Terms</Link>
          <a href={`mailto:${BRAND.supportEmail}`} className="hover:text-slate-900">Support</a>
        </div>
      </div>
    </footer>
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
