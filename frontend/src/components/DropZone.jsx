import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadFile, api } from '../lib/apiClient'
import { useCredits } from '../hooks/useCredits'
import { GRADIENTS } from '../lib/brand'
import { track } from '../lib/analytics'

const LANGUAGES = [
  { value: 'auto', label: 'Auto-Detect' },
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'gu', label: 'Gujarati' },
]

/**
 * Setup-state drop zone. Accepts .mp4/.mov, uploads with BYOK headers,
 * polls /jobs/{id} until 'ready', then hands segments + objectURL upstream.
 */
export default function DropZone({ onReady }) {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [language, setLanguage] = useState('auto')
  const [prompt, setPrompt] = useState('')
  const [startOffset, setStartOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const { balance, refresh: refreshCredits } = useCredits()
  const navigate = useNavigate()

  const pick = (f) => {
    if (!f) return
    const ok = /\.(mp4|mov)$/i.test(f.name)
    if (!ok) { setStatus({ ok: false, msg: 'Only .mp4 / .mov files supported.' }); return }
    setFile(f); setStatus(null)
  }

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false)
    pick(e.dataTransfer.files?.[0])
  }

  const handleGenerate = async () => {
    if (!file) { setStatus({ ok: false, msg: 'Drop a file first.' }); return }
    if (balance === 0) {
      setStatus({ ok: false, msg: 'No credits remaining. Top up to keep transcribing.' })
      return
    }
    setBusy(true); setStatus({ ok: true, msg: 'Uploading…' })
    track('upload_started', { language, size_mb: Math.round(file.size / 1024 / 1024) })
    try {
      const { job_id } = await uploadFile(file, language, prompt, startOffset)
      // Backend consumed a credit (managed flow). Refresh the badge.
      refreshCredits()
      setStatus({ ok: true, msg: `Job ${job_id} — transcribing…` })

      const job = await pollJob(job_id)
      const objectUrl = URL.createObjectURL(file)
      track('transcribe_ready', { job_id, language: job.language })
      onReady({ videoUrl: objectUrl, segments: job.segments, jobId: job_id })
    } catch (e) {
      track('upload_failed', { error: e.message })
      setStatus({ ok: false, msg: e.message })
      // Refresh in case the credit was refunded server-side after a 4xx/5xx.
      refreshCredits()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-xl space-y-4">
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors ${
            dragging ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-slate-300 hover:border-slate-400 bg-slate-50'
          }`}
        >
          <p className="text-slate-700">
            {file ? `📹 ${file.name}` : 'Drop a .mp4 or .mov here, or click to browse'}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </div>

        <div className="flex items-center justify-center gap-3">
          <label className="text-sm text-slate-700">Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-white text-slate-900 rounded px-3 py-2 text-sm border border-slate-200"
          >
            {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-1 text-center">
            Context hint (optional) — improves accuracy on niche vocab
          </label>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Hindi bhajan, devotional, classical lyrics"
            maxLength={224}
            className="w-full bg-white text-slate-900 rounded px-3 py-2 text-sm border border-slate-200"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-1 text-center">
            Skip intro / aalaap — start transcription at (seconds)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={120}
              step={0.5}
              value={startOffset}
              onChange={(e) => setStartOffset(parseFloat(e.target.value))}
              className="flex-1"
            />
            <input
              type="number"
              min={0}
              step={0.5}
              value={startOffset}
              onChange={(e) => setStartOffset(Math.max(0, parseFloat(e.target.value) || 0))}
              className="w-20 bg-white text-slate-900 rounded px-2 py-1 text-sm border border-slate-200 font-mono"
            />
            <span className="text-xs text-slate-500">s</span>
          </div>
        </div>

        {status && (
          <div className={`text-xs rounded px-3 py-2 text-center border ${
            status.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
          }`}>{status.msg}</div>
        )}

        {balance === 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm px-4 py-3 text-center space-y-2">
            <div>You're out of credits. Top up to keep transcribing.</div>
            <button
              onClick={() => navigate('/pricing')}
              className="px-4 py-1.5 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold"
            >
              See plans
            </button>
          </div>
        )}

        <div className="text-center">
          <button
            disabled={busy || !file || balance === 0}
            onClick={handleGenerate}
            style={busy || !file || balance === 0 ? undefined : { background: GRADIENTS.horizontal }}
            className="px-6 py-3 rounded-full shadow-md hover:shadow-lg transition-shadow text-white disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none font-semibold"
          >
            {busy ? 'Working…' : 'Generate Subtitles'}
          </button>
        </div>
      </div>
    </main>
  )
}

async function pollJob(jobId, intervalMs = 1000, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    const job = await api(`/jobs/${jobId}`)
    if (job.status === 'ready') return job
    if (job.status === 'failed') throw new Error(job.error || 'Job failed.')
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('Timed out waiting for transcription.')
}
