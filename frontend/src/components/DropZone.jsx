import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadFile, api } from '../lib/apiClient'
import { useCredits } from '../hooks/useCredits'
import { GRADIENTS } from '../lib/brand'

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
    try {
      const { job_id } = await uploadFile(file, language, prompt, startOffset)
      // Backend consumed a credit (managed flow). Refresh the badge.
      refreshCredits()
      setStatus({ ok: true, msg: `Job ${job_id} — transcribing…` })

      const job = await pollJob(job_id)
      const objectUrl = URL.createObjectURL(file)
      onReady({ videoUrl: objectUrl, segments: job.segments, jobId: job_id })
    } catch (e) {
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
            dragging ? 'border-[#7C3AED] bg-[#7C3AED]/10' : 'border-white/20 hover:border-white/40'
          }`}
        >
          <p className="text-white/70">
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
          <label className="text-sm text-white/70">Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-[#1a1a22] text-white rounded px-3 py-2 text-sm border border-white/10"
          >
            {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-white/50 mb-1 text-center">
            Context hint (optional) — improves accuracy on niche vocab
          </label>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Hindi bhajan, devotional, classical lyrics"
            maxLength={224}
            className="w-full bg-[#1a1a22] text-white rounded px-3 py-2 text-sm border border-white/10"
          />
        </div>

        <div>
          <label className="block text-xs text-white/50 mb-1 text-center">
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
              className="w-20 bg-[#1a1a22] text-white rounded px-2 py-1 text-sm border border-white/10 font-mono"
            />
            <span className="text-xs text-white/40">s</span>
          </div>
        </div>

        {status && (
          <div className={`text-xs rounded px-3 py-2 text-center ${
            status.ok ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/20 text-rose-200'
          }`}>{status.msg}</div>
        )}

        {balance === 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-100 text-sm px-4 py-3 text-center space-y-2">
            <div>You're out of credits. Top up to keep transcribing.</div>
            <button
              onClick={() => navigate('/pricing')}
              className="px-4 py-1.5 rounded-full bg-amber-400 hover:bg-amber-300 text-amber-950 text-xs font-semibold"
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
            className="px-6 py-3 rounded-full shadow-md hover:shadow-lg transition-shadow text-white disabled:bg-white/10 disabled:text-white/40 font-semibold"
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
