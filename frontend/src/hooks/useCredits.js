import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/apiClient'

/**
 * Credit balance + history hook.
 *
 * `balance` is what the top-bar badge renders; `history` powers a future
 * /account drilldown. `refresh()` refetches and ALSO fires a global event
 * so other live useCredits() consumers (e.g., the top-bar badge while the
 * DropZone is the active route) update without a hard reload.
 */
const CREDITS_REFRESH_EVENT = 'autosub:credits-refresh'

export function useCredits() {
  const [balance, setBalance] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchOnly = useCallback(async () => {
    try {
      const data = await api('/users/me/credits')
      setBalance(data.balance)
      setHistory(data.history || [])
    } catch {
      setBalance(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // refresh() locally and broadcast so every other consumer also refetches.
  const refresh = useCallback(async () => {
    await fetchOnly()
    try { window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT)) } catch { /* SSR safety */ }
  }, [fetchOnly])

  useEffect(() => {
    fetchOnly()
    const handler = () => { fetchOnly() }
    window.addEventListener(CREDITS_REFRESH_EVENT, handler)
    return () => window.removeEventListener(CREDITS_REFRESH_EVENT, handler)
  }, [fetchOnly])

  return { balance, history, loading, refresh }
}
