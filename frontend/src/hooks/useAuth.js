import { useCallback, useEffect, useState } from 'react'
import { identify, reset } from '../lib/analytics'

/**
 * Auth state hook. Backend identifies the user via httpOnly cookie set by
 * /auth/google/callback; the cookie is sent automatically by the browser
 * on every same-origin fetch. We never see the JWT in JS — we just call
 * /users/me to find out who's logged in.
 *
 * Returns:
 *   user        — { id, email, ... } | null
 *   loading     — true on initial fetch
 *   logout()    — POST /auth/logout, then clear local state
 *   refresh()   — re-fetch /users/me (after login redirect)
 */
export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/users/me', { credentials: 'include' })
      if (res.ok) {
        const me = await res.json()
        setUser(me)
        // Tie this browser to a stable user_id so PostHog funnels can
        // follow the same person across sessions / devices. Idempotent --
        // calling identify with the same id is a no-op after the first time.
        identify(me.id, { email: me.email })
        // Best-effort one-shot: claim any legacy (pre-auth) jobs. Server
        // returns 0 except for the very first user; rest of the time this
        // is a cheap no-op. Failure is silent — auth UX shouldn't break
        // if the claim endpoint is slow or transiently 5xx.
        fetch('/api/users/claim-orphans', {
          method: 'POST', credentials: 'include',
        }).catch(() => {})
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } catch { /* swallow — we clear local state regardless */ }
    // Drop the analytics identity too so the next signup on this browser
    // doesn't get merged into the previous user's funnel.
    reset()
    setUser(null)
  }, [])

  return { user, loading, logout, refresh }
}
