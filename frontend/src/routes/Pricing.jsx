import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/apiClient'

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
            <PlanCard key={plan.id} plan={plan} />
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

function PlanCard({ plan }) {
  const isSubscription = plan.cadence !== 'one_time'
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
        disabled={!plan.purchasable}
        title={plan.purchasable ? '' : 'Coming soon — Razorpay setup in progress'}
        onClick={() => {
          // TODO Slice 3b-continued: POST /checkout/{slug} -> open Razorpay Checkout modal
          alert('Checkout flow lands when Razorpay is configured.')
        }}
        className={`mt-5 px-4 py-2 rounded-full font-semibold text-sm transition-colors ${
          plan.purchasable
            ? 'bg-purple-500 hover:bg-purple-400 text-white'
            : 'bg-white/5 text-white/30 cursor-not-allowed'
        }`}
      >
        {plan.purchasable ? 'Buy now' : 'Coming soon'}
      </button>
    </li>
  )
}
