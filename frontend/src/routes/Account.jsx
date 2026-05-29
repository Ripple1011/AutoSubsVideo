import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useCredits } from '../hooks/useCredits'
import { GRADIENTS } from '../lib/brand'

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
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Account</h2>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2 font-semibold">Identity</div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-slate-900">{user?.email || '—'}</div>
            <div className="text-xs text-slate-500">Signed in via Google</div>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded border border-slate-200 hover:border-slate-300 hover:bg-slate-50"
          >
            Log out
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2 font-semibold">Credits</div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-3xl font-bold text-slate-900">
              🪙 {balance == null ? '—' : balance.toLocaleString('en-IN')}
            </div>
            <div className="text-xs text-slate-500">remaining videos</div>
          </div>
          <button
            onClick={() => navigate('/pricing')}
            style={{ background: GRADIENTS.horizontal }}
            className="px-4 py-2 rounded-full shadow-md hover:shadow-lg transition-shadow text-white font-semibold text-sm"
          >
            Get more
          </button>
        </div>

        {loading ? (
          <p className="text-xs text-slate-500">Loading history…</p>
        ) : history.length === 0 ? (
          <p className="text-xs text-slate-500">No credit history yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 uppercase tracking-wide">
                <th className="py-1 pr-3 font-semibold">Source</th>
                <th className="py-1 pr-3 font-semibold">Granted</th>
                <th className="py-1 pr-3 font-semibold">Remaining</th>
                <th className="py-1 pr-3 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {history.map((g) => (
                <tr key={g.id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3">{SOURCE_LABEL[g.source] || g.source}</td>
                  <td className="py-1.5 pr-3 font-mono">{g.credits_granted}</td>
                  <td className="py-1.5 pr-3 font-mono">{g.credits_remaining}</td>
                  <td className="py-1.5 pr-3 text-slate-500">{new Date(g.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2 font-semibold">Subscription</div>
        <p className="text-sm text-slate-600">
          You don't have an active subscription. Pick a plan on the{' '}
          <button
            onClick={() => navigate('/pricing')}
            className="text-[#7C3AED] hover:text-[#6D28D9] underline underline-offset-2 font-medium"
          >
            pricing page
          </button>.
        </p>
        <p className="text-[11px] text-slate-400 mt-2">
          Subscription management (change tier, cancel) lands when Razorpay is wired.
        </p>
      </section>
    </div>
  )
}
