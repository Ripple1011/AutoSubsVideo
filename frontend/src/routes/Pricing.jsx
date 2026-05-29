import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/apiClient'
import { loadRazorpaySDK } from '../lib/razorpay'
import { useAuth } from '../hooks/useAuth'
import { BRAND, GRADIENTS, LOGO, CTA } from '../lib/brand'

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
  const { user, loading: authLoading } = useAuth()
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

  // Logged-in users land here via the App shell (dark theme, with credit
  // badge / avatar in the top bar). Logged-out users land here from the
  // public Landing page and have no chrome yet — we render the same
  // TopNav + FooterMini lockup the Landing/Privacy/Terms routes use.
  const content = (
    <div className="max-w-6xl mx-auto p-6 pb-12">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-semibold tracking-tight">Pricing</h2>
        <p className={`text-sm mt-2 ${user ? 'text-white/50' : 'text-slate-600'}`}>
          Every plan uses <span className="font-mono">Gemini 2.5 Pro</span> —
          best accuracy on Hindi, Gujarati, and English short-form video.
        </p>
      </div>

      {!paymentsReady && !loading && !error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 text-xs px-4 py-3 mb-6 text-center">
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
        <p className={`text-sm text-center ${user ? 'text-white/40' : 'text-slate-500'}`}>
          Loading plans…
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} navigate={navigate} authed={Boolean(user)} />
          ))}
        </ul>
      )}

      {user && (
        <div className="mt-10 text-center">
          <button
            onClick={() => navigate('/projects')}
            className="text-xs text-white/40 hover:text-white underline underline-offset-2"
          >
            ← Back to projects
          </button>
        </div>
      )}
    </div>
  )

  // Authed: the App shell provides background + nav, just return content.
  if (authLoading || user) return content

  // Logged-out: wrap in the public marketing chrome (white bg + landing-
  // style top nav and footer) so the page doesn't feel orphaned.
  return (
    <div className="min-h-screen bg-white text-slate-800 font-[Inter]">
      <PublicTopNav />
      {content}
      <PublicFooter />
    </div>
  )
}

function PublicTopNav() {
  return (
    <header className="border-b border-slate-200/70 bg-white sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <img src={LOGO.full} alt={BRAND.name} className="h-14 w-auto" />
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link to="/pricing" className="text-slate-600 hover:text-slate-900 font-medium">Pricing</Link>
          <Link
            to="/login"
            className="px-5 py-2.5 rounded-full text-white font-semibold text-sm shadow-md hover:shadow-lg transition-shadow"
            style={{ background: GRADIENTS.horizontal }}
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  )
}

function PublicFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50 mt-12">
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

const CADENCE_LABEL = {
  one_time: 'One-time',
  monthly: 'per month',
  annual: 'per year',
}

function PlanCard({ plan, navigate, authed }) {
  const isSubscription = plan.cadence !== 'one_time'
  const [buying, setBuying] = useState(false)
  const [error, setError] = useState(null)

  // Logged-out users can't actually buy — bounce them to /login on click.
  // We don't want to silently open Razorpay Checkout against an unauth
  // session because /checkout/{slug} would 401 anyway.
  const handleBuy = authed ? handleBuyAuthed : () => navigate('/login')

  async function handleBuyAuthed() {
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

  // Style switches based on context. authed = on the dark App shell (white-
  // on-near-black). Logged-out = on the white public chrome.
  const cardClass = authed
    ? 'rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex flex-col'
    : 'rounded-2xl border border-slate-200 bg-white p-5 flex flex-col hover:border-slate-300 transition-colors'
  const cadenceClass = authed ? 'text-purple-400' : 'text-purple-600'
  const titleClass = authed ? 'text-lg font-semibold text-white' : 'text-lg font-semibold text-slate-900'
  const descClass = authed ? 'text-xs text-white/50 mt-1 min-h-[2.5rem]' : 'text-xs text-slate-500 mt-1 min-h-[2.5rem]'
  const priceClass = authed ? 'text-3xl font-bold text-white' : 'text-3xl font-bold text-slate-900'
  const subClass = authed ? 'text-[11px] text-white/40' : 'text-[11px] text-slate-400'

  return (
    <li className={cardClass}>
      <div className={`text-xs uppercase tracking-wide mb-1 ${cadenceClass}`}>
        {CADENCE_LABEL[plan.cadence] || plan.cadence}
      </div>
      <div className={titleClass}>{plan.display_name}</div>
      <div className={descClass}>
        {plan.description}
      </div>

      <div className="mt-4">
        <div className={priceClass}>₹{plan.price_inr.toLocaleString('en-IN')}</div>
        {isSubscription && (
          <div className={subClass}>
            {plan.cadence === 'monthly' ? 'billed monthly' : 'billed once a year'}
          </div>
        )}
      </div>

      <div className={`mt-3 text-sm ${authed ? 'text-white/70' : 'text-slate-600'}`}>
        🪙 {plan.credits_granted.toLocaleString('en-IN')} videos
        {plan.rollover_cap && (
          <span className={`text-xs ${authed ? 'text-white/40' : 'text-slate-400'}`}> · rolls over up to {plan.rollover_cap}</span>
        )}
      </div>

      <button
        disabled={(!plan.purchasable && authed) || buying}
        title={
          authed
            ? (plan.purchasable ? '' : 'Coming soon — Razorpay setup in progress')
            : 'Sign in to purchase'
        }
        onClick={handleBuy}
        className={
          authed
            ? `mt-5 px-4 py-2 rounded-full font-semibold text-sm transition-colors ${
                plan.purchasable
                  ? 'bg-purple-500 hover:bg-purple-400 text-white disabled:opacity-60'
                  : 'bg-white/5 text-white/30 cursor-not-allowed'
              }`
            : 'mt-5 px-4 py-2 rounded-full font-semibold text-sm transition-shadow shadow-md hover:shadow-lg text-white'
        }
        style={authed ? undefined : { background: GRADIENTS.horizontal }}
      >
        {!authed
          ? 'Sign in to buy'
          : !plan.purchasable
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
