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
    <span className="px-3 py-1 rounded-full bg-slate-100 text-xs text-slate-400 font-mono">
      …
    </span>
  )
  if (balance === null) return null

  const low = balance <= 3
  return (
    <span
      title={`${balance} credit${balance === 1 ? '' : 's'} remaining`}
      className={`px-3 py-1 rounded-full text-xs font-mono font-semibold ${
        low ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/20'
      }`}
    >
      🪙 {balance}
    </span>
  )
}
