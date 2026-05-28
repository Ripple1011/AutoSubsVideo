import { useCredits } from '../hooks/useCredits'

/**
 * Tiny pill in the top bar: "🪙 12". Click → opens a tooltip-style popover
 * with the grant history. Stays visible only when the user is logged in
 * (top bar renders nothing for guests). Uses useCredits — refreshes on
 * mount; upload flows call refresh() through their own hook instance after
 * a successful generate.
 */
export default function CreditsBadge() {
  const { balance, loading } = useCredits()

  if (loading) return (
    <span className="px-3 py-1 rounded-full bg-white/5 text-xs text-white/40 font-mono">
      …
    </span>
  )
  if (balance === null) return null

  const low = balance <= 3
  return (
    <span
      title={`${balance} credit${balance === 1 ? '' : 's'} remaining`}
      className={`px-3 py-1 rounded-full text-xs font-mono font-semibold ${
        low ? 'bg-rose-500/20 text-rose-200' : 'bg-purple-500/20 text-purple-200'
      }`}
    >
      🪙 {balance}
    </span>
  )
}
