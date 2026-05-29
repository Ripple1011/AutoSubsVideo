import { useEffect, useState } from 'react'
import { api, loadByok, saveByok, clearByok } from '../lib/apiClient'

/**
 * BYOK Settings modal — pick provider, model, paste API key.
 * Stored only in browser localStorage; sent per-request as X-User-ASR-* headers.
 * Backend falls back to server .env when these are absent.
 */
export default function SettingsModal({ open, onClose }) {
  const [providerModels, setProviderModels] = useState({})
  const [serverDefaults, setServerDefaults] = useState(null)
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState(null)
  // Power-user toggle. Default: collapsed/hidden because managed-Gemini is
  // the supported path. Users with their own key flip this on, paste it,
  // and bypass the credit system entirely (their key, their bill).
  const [byokOpen, setByokOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const stored = loadByok()
    setProvider(stored.provider || '')
    setModel(stored.model || '')
    setApiKey(stored.apiKey || '')
    // If the user already has a saved BYOK key, open the section so they
    // see what's configured.
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
    setStatus({ ok: true, msg: 'Saved to browser. Sent as headers on every request.' })
  }

  const handleClear = () => {
    clearByok()
    setProvider(''); setModel(''); setApiKey('')
    setStatus({ ok: true, msg: 'Cleared. Server .env will be used.' })
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

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#16161d] border border-white/10 rounded-2xl w-full max-w-lg p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Transcription</h2>
          <button className="text-white/50 hover:text-white" onClick={onClose}>✕</button>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-1">
          <div className="text-sm text-white/85">
            Managed by AutoSub — <span className="font-mono">Gemini 2.5 Pro</span>
          </div>
          <div className="text-xs text-white/50">
            Each transcription uses one credit from your balance. Best
            accuracy across English, Hindi, Gujarati.
          </div>
        </div>

        <button
          onClick={() => setByokOpen((v) => !v)}
          className="text-xs text-white/40 hover:text-white/70 underline underline-offset-2"
        >
          {byokOpen ? '▾ Hide advanced (bring your own API key)' : '▸ Advanced: bring your own API key'}
        </button>

        {byokOpen && (
          <div className="space-y-3 pt-1 border-t border-white/10">
            <p className="text-xs text-white/50">
              Power users only. With a personal key your transcriptions hit
              the provider directly and don't consume your credits — but
              you also lose Pro accuracy guarantees because you can pick a
              cheaper model. Key stays in this browser only.
            </p>

            <label className="block text-sm">
              <span className="text-white/70 block mb-1">Provider</span>
              <select
                value={provider}
                onChange={(e) => { setProvider(e.target.value); setModel('') }}
                className="w-full bg-[#1a1a22] text-white rounded px-3 py-2 border border-white/10"
              >
                <option value="">(use server default)</option>
                {Object.keys(providerModels).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="text-white/70 block mb-1">Model</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={!provider}
                className="w-full bg-[#1a1a22] text-white rounded px-3 py-2 border border-white/10 disabled:opacity-40"
              >
                <option value="">(provider default)</option>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>

            <label className="block text-sm">
              <span className="text-white/70 block mb-1">API Key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-... or gsk_..."
                className="w-full bg-[#1a1a22] text-white rounded px-3 py-2 border border-white/10 font-mono text-xs"
              />
            </label>

            <div className="flex gap-2 pt-1">
              <button onClick={handleTest} className="flex-1 px-4 py-2 rounded bg-white/10 hover:bg-white/20 text-sm">
                Test Connection
              </button>
              <button onClick={handleClear} className="px-4 py-2 rounded bg-white/5 hover:bg-white/10 text-sm">
                Clear
              </button>
              <button onClick={handleSave} className="flex-1 px-4 py-2 rounded bg-[#7C3AED] hover:bg-[#6D28D9] text-sm font-semibold">
                Save
              </button>
            </div>
          </div>
        )}

        {status && (
          <div className={`text-xs rounded px-3 py-2 ${status.ok ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/20 text-rose-200'}`}>
            {status.msg}
          </div>
        )}
      </div>
    </div>
  )
}
