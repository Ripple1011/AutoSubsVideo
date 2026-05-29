import { useEffect, useState } from 'react'
import { api, loadByok, saveByok, clearByok } from '../lib/apiClient'

/**
 * Settings modal — managed Gemini by default, BYOK as a power-user opt-in.
 *
 * Layout: light theme, two visual zones —
 *   1. Top: hero card showing the current transcription engine
 *      (Managed Gemini 2.5 Pro). Always visible; communicates the
 *      default state in one glance.
 *   2. Bottom: collapsible "Advanced" panel for users who want to
 *      bring their own API key. Hidden by default (clean modal for
 *      the 95% case); auto-expands if a saved BYOK key is present
 *      so returning power users see their config.
 *
 * The Test Connection button always runs against the server's
 * resolution path (BYOK header first, server .env fallback), so the
 * status banner doubles as a live diagnostic regardless of whether
 * BYOK is configured or not.
 */
export default function SettingsModal({ open, onClose }) {
  const [providerModels, setProviderModels] = useState({})
  const [serverDefaults, setServerDefaults] = useState(null)
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState(null)
  const [byokOpen, setByokOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const stored = loadByok()
    setProvider(stored.provider || '')
    setModel(stored.model || '')
    setApiKey(stored.apiKey || '')
    setByokOpen(Boolean(stored.apiKey))
    setStatus(null)

    api('/health').then((h) => {
      setProviderModels(h.provider_models || {})
      setServerDefaults({
        provider: h.server_default_provider,
        model: h.server_default_model,
        hasGroq: h.server_has_groq_key,
        hasOpenai: h.server_has_openai_key,
        hasSarvam: h.server_has_sarvam_key,
        hasGemini: h.server_has_gemini_key,
      })
    }).catch((e) => setStatus({ ok: false, msg: `Health failed: ${e.message}` }))
  }, [open])

  const handleSave = () => {
    saveByok({ provider, model, apiKey })
    setStatus({ ok: true, msg: 'Saved. Sent as headers on every request from this browser.' })
  }

  const handleClear = () => {
    clearByok()
    setProvider(''); setModel(''); setApiKey('')
    setStatus({ ok: true, msg: 'Cleared. Vaacha-managed Gemini will be used.' })
  }

  const handleTest = async () => {
    try {
      saveByok({ provider, model, apiKey })
      const res = await api('/asr/check', { method: 'POST' })
      setStatus({
        ok: true,
        msg: `Resolved → ${res.resolved_provider} / ${res.resolved_model} (key from: ${res.key_source})`,
      })
    } catch (e) {
      setStatus({ ok: false, msg: e.message })
    }
  }

  if (!open) return null

  const models = provider && providerModels[provider] ? providerModels[provider] : []
  const byokConfigured = Boolean(apiKey)

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Transcription Settings</h2>
            <p className="text-xs text-slate-500 mt-0.5">Choose how Vaacha generates your subtitles.</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Managed engine card */}
          <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    {byokConfigured ? 'Overridden' : 'Active'}
                  </span>
                </div>
                <div className="text-sm font-semibold text-slate-900 mt-1.5">
                  Managed by Vaacha
                </div>
                <div className="text-xs text-slate-600 mt-0.5">
                  <span className="font-mono">Gemini 2.5 Pro</span> · best accuracy for Hindi, Gujarati, English
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500">Cost</div>
                <div className="text-sm font-semibold text-slate-900">🪙 1 credit / video</div>
              </div>
            </div>
            {byokConfigured && (
              <div className="mt-3 pt-3 border-t border-slate-200 text-xs text-slate-600">
                Currently bypassed — your API key in the Advanced section below is
                being used instead. Clear it to switch back to managed Vaacha.
              </div>
            )}
          </div>

          {/* Advanced (BYOK) section */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <button
              onClick={() => setByokOpen((v) => !v)}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Advanced: bring your own API key
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Power users only · your usage isn't billed against credits
                </div>
              </div>
              <span className="text-slate-400 text-lg">
                {byokOpen ? '▴' : '▾'}
              </span>
            </button>

            {byokOpen && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-200 bg-slate-50/50">
                <p className="text-xs text-slate-600 leading-relaxed">
                  When set, transcriptions hit the provider directly with your
                  key — Vaacha doesn't see your audio's billing. You pick
                  provider + model; key never leaves this browser.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs">
                    <span className="text-slate-700 font-medium block mb-1">Provider</span>
                    <select
                      value={provider}
                      onChange={(e) => { setProvider(e.target.value); setModel('') }}
                      className="w-full bg-white text-slate-900 rounded-lg px-3 py-2 border border-slate-300 text-sm focus:border-slate-500 focus:outline-none"
                    >
                      <option value="">(server default)</option>
                      {Object.keys(providerModels).map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-xs">
                    <span className="text-slate-700 font-medium block mb-1">Model</span>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={!provider}
                      className="w-full bg-white text-slate-900 rounded-lg px-3 py-2 border border-slate-300 text-sm focus:border-slate-500 focus:outline-none disabled:opacity-50 disabled:bg-slate-100"
                    >
                      <option value="">(default)</option>
                      {models.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                </div>

                <label className="block text-xs">
                  <span className="text-slate-700 font-medium block mb-1">API Key</span>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="AIzaSy... or sk-... or gsk_..."
                    className="w-full bg-white text-slate-900 rounded-lg px-3 py-2 border border-slate-300 font-mono text-xs focus:border-slate-500 focus:outline-none"
                  />
                </label>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleTest}
                    className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-medium"
                  >
                    Test connection
                  </button>
                  <button
                    onClick={handleClear}
                    className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-medium"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleSave}
                    className="flex-1 px-3 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold"
                  >
                    Save key
                  </button>
                </div>

                {serverDefaults && (
                  <div className="text-[10px] text-slate-500 pt-2 border-t border-slate-200">
                    <span className="font-semibold">Server defaults:</span>{' '}
                    <span className="font-mono">{serverDefaults.provider}/{serverDefaults.model}</span>
                    {' · keys: '}
                    {[
                      ['gemini', serverDefaults.hasGemini],
                      ['groq', serverDefaults.hasGroq],
                      ['openai', serverDefaults.hasOpenai],
                      ['sarvam', serverDefaults.hasSarvam],
                    ].map(([name, has], i) => (
                      <span key={name}>
                        {i > 0 && ', '}
                        {name}{' '}
                        <span className={has ? 'text-emerald-700' : 'text-slate-400'}>
                          {has ? '✓' : '✗'}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Status banner */}
          {status && (
            <div
              className={`text-xs rounded-lg px-3 py-2 border ${
                status.ok
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              {status.msg}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
