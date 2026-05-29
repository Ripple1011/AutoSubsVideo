import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/apiClient'
import { loadRazorpaySDK } from '../lib/razorpay'
import { useAuth } from '../hooks/useAuth'
import { BRAND, GRADIENTS, LOGO, CTA } from '../lib/brand'
import AppTopBar from '../components/AppTopBar'
import AppFooter from '../components/AppFooter'

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

  // Slice 6: the authed app is also light now, so the same `content` works
  // for both logged-in (rendered inside App shell) and logged-out (wrapped
  // in PublicTopNav/Footer) cases. The PlanCard buttons differ slightly
  // for logged-out users -- they bounce to /login instead of opening
  // Razorpay -- which is handled by the `authed` prop.
  const content = (
    <div className="max-w-6xl mx-auto p-6 pb-12">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900">Pricing</h2>
        <p className="text-sm mt-2 text-slate-600">
          Every plan uses <span className="font-mono">Gemini 2.5 Pro</span> —
          best accuracy on Hindi, Gujarati, and English short-form video.
        </p>
      </div>

      {!paymentsReady && !loading && !error && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-xs px-4 py-3 mb-6 text-center">
          Payment processing is being set up. Plans will become purchasable
          once Razorpay (UPI / cards / netbanking) integration is complete.
        </div>
      )}

      {error && (
        <div className="rounded px-3 py-2 mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-center text-slate-500">
          Loading plans…
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} navigate={navigate} authed={Boolean(user)} />
          ))}
        </ul>
      )}

    </div>
  )

  // Authed: render with the same AppTopBar + AppFooter as every other
  // authed page. /pricing is mounted globally (so logged-out visitors
  // can also reach it) rather than nested inside App, so we have to
  // bring the chrome in ourselves.
  if (authLoading) return null
  if (user) {
    return (
      <div className="min-h-screen flex flex-col bg-white text-slate-900">
        <AppTopBar />
        <div className="flex-1">{content}</div>
        <AppFooter />
      </div>
    )
  }

  // Logged-out: wrap in the public marketing chrome.
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
          <Link to="/" className="text-slate-600 hover:text-slate-900 font-medium">Home</Link>
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

  // Slice 6: app is light everywhere now, so the same card styles work for
  // both authed and logged-out contexts. `authed` only affects button
  // copy + behavior below (logged-out users bounce to /login on Buy).
  const cardClass = 'rounded-2xl border border-slate-200 bg-white p-5 flex flex-col shadow-xl hover:border-slate-300 hover:shadow-2xl transition-all'
  const cadenceClass = 'text-[#7C3AED]'
  const titleClass = 'text-lg font-semibold text-slate-900'
  const descClass = 'text-xs text-slate-500 mt-1 min-h-[2.5rem]'
  const priceClass = 'text-3xl font-bold text-slate-900'
  const subClass = 'text-[11px] text-slate-400'

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

      <div className="mt-3 text-sm text-slate-600">
        🪙 {plan.credits_granted.toLocaleString('en-IN')} videos
        {plan.rollover_cap && (
          <span className="text-xs text-slate-400"> · rolls over up to {plan.rollover_cap}</span>
        )}
      </div>

      {/* Flex spacer — absorbs any vertical-height difference between cards
          so all Buy buttons in the row land on the same baseline. */}
      <div className="flex-1" />

      <button
        disabled={(!plan.purchasable && authed) || buying}
        title={
          authed
            ? (plan.purchasable ? '' : 'Coming soon — Razorpay setup in progress')
            : 'Sign in to purchase'
        }
        onClick={handleBuy}
        style={(authed && !plan.purchasable) ? undefined : { background: GRADIENTS.horizontal }}
        className={
          // `mt-5` gives a consistent breathing gap above the button. The
          // card uses `flex flex-col` and we drop a `flex-1` spacer above
          // this button so all Buy buttons land on the same baseline even
          // when description / rollover note / cadence sub-line heights
          // differ between plans.
          authed && !plan.purchasable
            ? 'mt-5 px-4 py-2 rounded-full font-semibold text-sm bg-slate-100 text-slate-400 cursor-not-allowed'
            : 'mt-5 px-4 py-2 rounded-full font-semibold text-sm shadow-md hover:shadow-lg transition-shadow text-white disabled:opacity-60'
        }
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
