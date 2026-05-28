import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/apiClient'
import { loadRazorpaySDK } from '../lib/razorpay'

/**
 * /pricing — public list of purchasable plans.
 *
 * Each card shows display_name, credits, price in INR, cadence ribbon.
 * "Buy" button is disabled with an explanatory tooltip when the plan's
 * razorpay_plan_id is null (Razorpay wiring is Slice 3b-continued). Once
 * Razorpay is wired the button POSTs to /checkout/{slug}.
 */
export default function Pricing() {
  const navigate = useNavigate()
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api('/plans').then((data) => {
      setPlans(data.plans || [])
      setLoading(false)
    }).catch((e) => {
      setError(e.message)
      setLoading(false)
    })
  }, [])

  const paymentsReady = plans.some((p) => p.purchasable)

  return (
    <div className="max-w-6xl mx-auto p-6 pb-12">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-semibold tracking-tight">Pricing</h2>
        <p className="text-white/50 text-sm mt-2">
          Every plan uses <span className="font-mono">Gemini 2.5 Pro</span> —
          best accuracy on Hindi, Gujarati, and English short-form video.
        </p>
      </div>

      {!paymentsReady && !loading && !error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs px-4 py-3 mb-6 text-center">
          Payment processing is being set up. Plans will become purchasable
          once Razorpay (UPI / cards / netbanking) integration is complete.
        </div>
      )}

      {error && (
        <div className="rounded px-3 py-2 mb-4 bg-rose-500/20 text-rose-200 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-white/40 text-sm text-center">Loading plans…</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} navigate={navigate} />
          ))}
        </ul>
      )}

      <div className="mt-10 text-center">
        <button
          onClick={() => navigate('/projects')}
          className="text-xs text-white/40 hover:text-white underline underline-offset-2"
        >
          ← Back to projects
        </button>
      </div>
    </div>
  )
}

const CADENCE_LABEL = {
  one_time: 'One-time',
  monthly: 'per month',
  annual: 'per year',
}

function PlanCard({ plan, navigate }) {
  const isSubscription = plan.cadence !== 'one_time'
  const [buying, setBuying] = useState(false)
  const [error, setError] = useState(null)

  const handleBuy = async () => {
    setBuying(true)
    setError(null)
    try {
      // 1. Backend creates a Razorpay Order (one-time) or Subscription.
      const cfg = await api(`/checkout/${plan.slug}`, { method: 'POST' })
      // 2. Lazy-load Checkout SDK.
      await loadRazorpaySDK()
      // 3. Open the Razorpay Checkout modal. handler runs on success.
      const options = {
        key: cfg.key_id,
        amount: cfg.amount,
        currency: cfg.currency,
        name: cfg.name,
        description: cfg.description,
        order_id: cfg.order_id,
        prefill: cfg.prefill,
        theme: { color: '#aa3bff' },
        // Explicitly enable each payment method we want surfaced as a tab in
        // the Checkout modal. Without this, test-mode Checkout sometimes
        // hides UPI for accounts whose dashboard config doesn't have it
        // toggled on yet. Methods the account genuinely doesn't support
        // (e.g. EMI for new accounts) get dropped silently — harmless.
        method: {
          upi: true,
          card: true,
          netbanking: true,
          wallet: true,
        },
        modal: {
          ondismiss: () => setBuying(false),
        },
        handler: async (response) => {
          try {
            const verified = await api('/razorpay/verify', {
              method: 'POST',
              body: {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                slug: cfg.slug,
              },
            })
            // Refresh the credits badge across the app, then go to Account.
            try { window.dispatchEvent(new Event('autosub:credits-refresh')) } catch {}
            navigate('/account')
            // Tiny console log so devs can confirm balance updated.
            console.log('[razorpay] credited', verified)
          } catch (e) {
            setError(`Payment captured but verification failed: ${e.message}`)
          } finally {
            setBuying(false)
          }
        },
      }
      const rzp = new window.Razorpay(options)
      rzp.on('payment.failed', (resp) => {
        setError(`Payment failed: ${resp.error?.description || 'unknown error'}`)
        setBuying(false)
      })
      rzp.open()
    } catch (e) {
      setError(e.message)
      setBuying(false)
    }
  }

  return (
    <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex flex-col">
      <div className="text-xs uppercase tracking-wide text-purple-400 mb-1">
        {CADENCE_LABEL[plan.cadence] || plan.cadence}
      </div>
      <div className="text-lg font-semibold">{plan.display_name}</div>
      <div className="text-xs text-white/50 mt-1 min-h-[2.5rem]">
        {plan.description}
      </div>

      <div className="mt-4">
        <div className="text-3xl font-bold">₹{plan.price_inr.toLocaleString('en-IN')}</div>
        {isSubscription && (
          <div className="text-[11px] text-white/40">
            {plan.cadence === 'monthly' ? 'billed monthly' : 'billed once a year'}
          </div>
        )}
      </div>

      <div className="mt-3 text-sm text-white/70">
        🪙 {plan.credits_granted.toLocaleString('en-IN')} videos
        {plan.rollover_cap && (
          <span className="text-white/40 text-xs"> · rolls over up to {plan.rollover_cap}</span>
        )}
      </div>

      <button
        disabled={!plan.purchasable || buying}
        title={plan.purchasable ? '' : 'Coming soon — Razorpay setup in progress'}
        onClick={handleBuy}
        className={`mt-5 px-4 py-2 rounded-full font-semibold text-sm transition-colors ${
          plan.purchasable
            ? 'bg-purple-500 hover:bg-purple-400 text-white disabled:opacity-60'
            : 'bg-white/5 text-white/30 cursor-not-allowed'
        }`}
      >
        {!plan.purchasable
          ? 'Coming soon'
          : buying
          ? 'Opening…'
          : 'Buy now'}
      </button>
      {error && (
        <div className="mt-2 text-[11px] rounded px-2 py-1 bg-rose-500/20 text-rose-200">
          {error}
        </div>
      )}
    </li>
  )
}
