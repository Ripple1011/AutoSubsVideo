import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { api } from '../lib/apiClient'

/**
 * /admin/plans — superuser-only plan management.
 *
 * Edit table for the 4 starter plans (and any plans created later).
 * Edits are saved per-row via PATCH /admin/plans/{id}. New plans can
 * be created via the row at the bottom. The frontend never edits paise
 * directly — users type rupees, we multiply by 100 before sending.
 *
 * Razorpay sync button is a placeholder until Slice 3b-continued lands;
 * once it does, the button will POST /admin/plans/{id}/sync-to-razorpay.
 */
export default function AdminPlans() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = async () => {
    try {
      const data = await api('/admin/plans')
      setPlans(data.plans || [])
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  // Guard route. Backend already rejects non-superuser with 403, but
  // showing a friendlier message in the UI saves the round-trip.
  if (authLoading) {
    return <p className="p-6 text-slate-500 text-sm">Checking permissions…</p>
  }
  if (!user?.is_superuser) {
    return (
      <div className="max-w-md mx-auto p-6 text-center">
        <p className="text-sm text-rose-600">
          This page is restricted to administrators.
        </p>
        <button
          onClick={() => navigate('/projects')}
          className="mt-4 text-xs text-slate-600 hover:text-slate-900 underline underline-offset-2"
        >
          ← Back to projects
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-6 pb-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Plan Management</h2>
          <p className="text-xs text-slate-500 mt-1">
            Edit prices, credits, or visibility. Slug and cadence are immutable
            after creation.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded px-3 py-2 mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 uppercase tracking-wide text-xs">
              <th className="py-2 pr-3 font-normal">Slug</th>
              <th className="py-2 pr-3 font-normal">Name</th>
              <th className="py-2 pr-3 font-normal">Description</th>
              <th className="py-2 pr-3 font-normal">Credits</th>
              <th className="py-2 pr-3 font-normal">Price (₹)</th>
              <th className="py-2 pr-3 font-normal">Cadence</th>
              <th className="py-2 pr-3 font-normal">Rollover</th>
              <th className="py-2 pr-3 font-normal">Order</th>
              <th className="py-2 pr-3 font-normal">Active</th>
              <th className="py-2 pr-3 font-normal">Razorpay</th>
              <th className="py-2 pr-3 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <PlanRow key={p.id} plan={p} onSaved={refresh} />
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-10 text-center">
        <button
          onClick={() => navigate('/projects')}
          className="text-xs text-slate-500 hover:text-slate-900 underline underline-offset-2"
        >
          ← Back to projects
        </button>
      </div>
    </div>
  )
}

function PlanRow({ plan, onSaved }) {
  const [draft, setDraft] = useState({
    display_name: plan.display_name,
    description: plan.description,
    credits_granted: plan.credits_granted,
    price_inr: plan.price_inr,
    rollover_cap: plan.rollover_cap ?? '',
    sort_order: plan.sort_order,
    active: plan.active,
  })
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [rowError, setRowError] = useState(null)

  const dirty = (
    draft.display_name !== plan.display_name
    || draft.description !== plan.description
    || Number(draft.credits_granted) !== plan.credits_granted
    || Number(draft.price_inr) !== plan.price_inr
    || (draft.rollover_cap === '' ? null : Number(draft.rollover_cap)) !== plan.rollover_cap
    || Number(draft.sort_order) !== plan.sort_order
    || Boolean(draft.active) !== plan.active
  )

  const sync = async () => {
    setSyncing(true)
    setRowError(null)
    try {
      await api(`/admin/plans/${plan.id}/sync-to-razorpay`, { method: 'POST' })
      await onSaved()
    } catch (e) {
      setRowError(e.message)
    } finally {
      setSyncing(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setRowError(null)
    try {
      await api(`/admin/plans/${plan.id}`, {
        method: 'PATCH',
        body: {
          display_name: draft.display_name,
          description: draft.description,
          credits_granted: Number(draft.credits_granted),
          price_inr_paise: Math.round(Number(draft.price_inr) * 100),
          rollover_cap: draft.rollover_cap === '' ? null : Number(draft.rollover_cap),
          sort_order: Number(draft.sort_order),
          active: Boolean(draft.active),
        },
      })
      await onSaved()
    } catch (e) {
      setRowError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const cell = "py-2 pr-3 align-top"
  const inputCls = "w-full bg-white text-slate-900 rounded px-2 py-1 text-xs border border-slate-300 focus:border-slate-500 focus:outline-none"

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className={cell}>
          <span className="font-mono text-xs text-slate-600">{plan.slug}</span>
        </td>
        <td className={cell}>
          <input
            value={draft.display_name}
            onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
            className={inputCls}
            style={{ minWidth: '8rem' }}
          />
        </td>
        <td className={cell}>
          <input
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className={inputCls}
            style={{ minWidth: '14rem' }}
          />
        </td>
        <td className={cell}>
          <input
            type="number" min={0}
            value={draft.credits_granted}
            onChange={(e) => setDraft({ ...draft, credits_granted: e.target.value })}
            className={`${inputCls} w-20 font-mono`}
          />
        </td>
        <td className={cell}>
          <input
            type="number" min={0} step="0.01"
            value={draft.price_inr}
            onChange={(e) => setDraft({ ...draft, price_inr: e.target.value })}
            className={`${inputCls} w-24 font-mono`}
          />
        </td>
        <td className={cell}>
          <span className="font-mono text-xs text-slate-600">{plan.cadence}</span>
        </td>
        <td className={cell}>
          <input
            type="number" min={0}
            value={draft.rollover_cap}
            placeholder="—"
            onChange={(e) => setDraft({ ...draft, rollover_cap: e.target.value })}
            className={`${inputCls} w-20 font-mono`}
          />
        </td>
        <td className={cell}>
          <input
            type="number" min={0}
            value={draft.sort_order}
            onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })}
            className={`${inputCls} w-16 font-mono`}
          />
        </td>
        <td className={cell}>
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            className="w-4 h-4 accent-purple-500"
          />
        </td>
        <td className={cell}>
          <div className="flex flex-col items-start gap-1">
            {plan.razorpay_plan_id ? (
              <span className="text-[10px] text-emerald-400 font-mono" title={plan.razorpay_plan_id}>
                synced
              </span>
            ) : (
              <span className="text-[10px] text-slate-400">not synced</span>
            )}
            <button
              onClick={sync}
              disabled={syncing || (plan.razorpay_plan_id && plan.cadence === 'one_time')}
              title={
                plan.razorpay_plan_id && plan.cadence === 'one_time'
                  ? 'One-time packs use a sentinel id; re-sync not required.'
                  : 'Register this plan with Razorpay'
              }
              className="text-[10px] px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:text-slate-900 hover:border-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {syncing ? '…' : plan.razorpay_plan_id ? 'Re-sync' : 'Sync'}
            </button>
          </div>
        </td>
        <td className={cell}>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="text-xs px-3 py-1 rounded bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:bg-slate-200 disabled:text-slate-400 font-semibold"
          >
            {saving ? '…' : 'Save'}
          </button>
        </td>
      </tr>
      {rowError && (
        <tr className="border-t border-rose-200">
          <td colSpan={11} className="py-1.5 px-3 text-xs text-rose-700 bg-rose-50">
            {rowError}
          </td>
        </tr>
      )}
    </>
  )
}
