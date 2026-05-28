import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useCredits } from '../hooks/useCredits'

const SOURCE_LABEL = {
  signup_bonus: 'Signup bonus',
  superuser_dev: 'Dev allotment',
  pack_10: 'Starter Pack',
  pack_50: 'Creator Pack',
  monthly: 'Pro Monthly',
  annual: 'Pro Annual',
  refund: 'Refund',
}

/**
 * /account — user dashboard.
 *
 * Three sections: identity (email + logout), credit balance + history,
 * subscription management (placeholder; Razorpay subscription controls land in
 * Slice 3b-continued). Keep it minimal and information-dense — this is
 * not a marketing surface.
 */
export default function Account() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { balance, history, loading } = useCredits()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="max-w-3xl mx-auto p-6 pb-12 space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">Account</h2>

      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="text-xs uppercase tracking-wide text-white/40 mb-2">Identity</div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{user?.email || '—'}</div>
            <div className="text-xs text-white/40">Signed in via Google</div>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-white/60 hover:text-white px-3 py-1.5 rounded border border-white/10 hover:border-white/30"
          >
            Log out
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="text-xs uppercase tracking-wide text-white/40 mb-2">Credits</div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-3xl font-bold">
              🪙 {balance == null ? '—' : balance.toLocaleString('en-IN')}
            </div>
            <div className="text-xs text-white/40">remaining videos</div>
          </div>
          <button
            onClick={() => navigate('/pricing')}
            className="px-4 py-2 rounded-full bg-purple-500 hover:bg-purple-400 font-semibold text-sm"
          >
            Get more
          </button>
        </div>

        {loading ? (
          <p className="text-xs text-white/40">Loading history…</p>
        ) : history.length === 0 ? (
          <p className="text-xs text-white/40">No credit history yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-white/40 uppercase tracking-wide">
                <th className="py-1 pr-3 font-normal">Source</th>
                <th className="py-1 pr-3 font-normal">Granted</th>
                <th className="py-1 pr-3 font-normal">Remaining</th>
                <th className="py-1 pr-3 font-normal">Date</th>
              </tr>
            </thead>
            <tbody className="text-white/80">
              {history.map((g) => (
                <tr key={g.id} className="border-t border-white/5">
                  <td className="py-1.5 pr-3">{SOURCE_LABEL[g.source] || g.source}</td>
                  <td className="py-1.5 pr-3 font-mono">{g.credits_granted}</td>
                  <td className="py-1.5 pr-3 font-mono">{g.credits_remaining}</td>
                  <td className="py-1.5 pr-3 text-white/40">{new Date(g.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="text-xs uppercase tracking-wide text-white/40 mb-2">Subscription</div>
        <p className="text-sm text-white/60">
          You don't have an active subscription. Pick a plan on the{' '}
          <button
            onClick={() => navigate('/pricing')}
            className="text-purple-300 hover:text-purple-200 underline underline-offset-2"
          >
            pricing page
          </button>.
        </p>
        <p className="text-[11px] text-white/30 mt-2">
          Subscription management (change tier, cancel) lands when Razorpay is wired.
        </p>
      </section>
    </div>
  )
}
