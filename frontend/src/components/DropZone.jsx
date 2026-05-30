import { useEffect, useRef, useState } from 'react'
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
  // Skip-intro slider was removed -- always send 0. Backend still expects
  // the parameter on uploadFile() so we keep the literal here.
  const startOffset = 0
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

  // Live progress state -- drives the animated phase pill + elapsed timer
  // while a job is in flight. Phases match the backend statuses returned by
  // /jobs/{id}: queued -> extracting -> transcribing -> ready.
  const [phase, setPhase] = useState(null)        // null | 'uploading' | 'extracting' | 'transcribing' | 'ready'
  const [elapsedMs, setElapsedMs] = useState(0)

  // Re-tick `elapsedMs` every 50ms while a phase is active. 50ms is fast
  // enough to read like a stopwatch (centiseconds visible) and cheap
  // enough that the re-render cost is invisible -- nothing else on this
  // page depends on the elapsed value.
  useEffect(() => {
    if (!phase || phase === 'ready') return
    const startedAt = Date.now() - elapsedMs
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 50)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const handleGenerate = async () => {
    if (!file) { setStatus({ ok: false, msg: 'Drop a file first.' }); return }
    if (balance === 0) {
      setStatus({ ok: false, msg: 'No credits remaining. Top up to keep transcribing.' })
      return
    }
    setBusy(true); setStatus(null)
    setElapsedMs(0)
    setPhase('uploading')
    track('upload_started', { language, size_mb: Math.round(file.size / 1024 / 1024) })
    try {
      const { job_id } = await uploadFile(file, language, prompt, startOffset)
      // Backend consumed a credit (managed flow). Refresh the badge.
      refreshCredits()
      setPhase('extracting')

      const job = await pollJob(job_id, 1000, 120, (s) => {
        // Map backend status -> our phase enum so the pill text tracks
        // server-side progress in real time. 'queued' is a brief blip
        // before extracting kicks off; show extracting either way.
        if (s === 'extracting' || s === 'queued') setPhase('extracting')
        else if (s === 'transcribing') setPhase('transcribing')
      })
      const objectUrl = URL.createObjectURL(file)
      setPhase('ready')
      track('transcribe_ready', { job_id, language: job.language })
      onReady({ videoUrl: objectUrl, segments: job.segments, jobId: job_id })
    } catch (e) {
      track('upload_failed', { error: e.message })
      setStatus({ ok: false, msg: e.message })
      setPhase(null)
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

        {phase && <ProgressIndicator phase={phase} elapsedMs={elapsedMs} />}

        {status && !status.ok && (
          <div className="text-xs rounded px-3 py-2 text-center border bg-rose-50 text-rose-700 border-rose-200">
            {status.msg}
          </div>
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

/**
 * Live progress card shown while a job runs. Reads:
 *   - phase: current pipeline step (drives label + step pill highlights)
 *   - elapsedMs: re-ticked from the parent every 50ms so the timer reads
 *     mm:ss.cs and feels responsive.
 *
 * The bar is "indeterminate" -- we don't actually know percent-complete
 * for upload or transcription, but a confidently-moving bar reads as
 * "something is happening" which is the whole point. A pulsing fill
 * (CSS @keyframes vaacha-shimmer in index.css) sells it.
 */
function ProgressIndicator({ phase, elapsedMs }) {
  const STEPS = [
    { key: 'uploading', label: 'Uploading' },
    { key: 'extracting', label: 'Extracting audio' },
    { key: 'transcribing', label: 'Transcribing' },
    { key: 'ready', label: 'Ready' },
  ]
  const currentIdx = STEPS.findIndex((s) => s.key === phase)

  const mm = String(Math.floor(elapsedMs / 60000)).padStart(2, '0')
  const ss = String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, '0')
  const cs = String(Math.floor((elapsedMs % 1000) / 10)).padStart(2, '0')

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-800">
          {STEPS[currentIdx]?.label || 'Working'}…
        </div>
        <div className="font-mono text-sm tabular-nums text-slate-500">
          {mm}:{ss}<span className="text-xs">.{cs}</span>
        </div>
      </div>

      {/* Indeterminate progress bar -- a moving gradient stripe inside a
          slate track. The actual width % isn't meaningful; the animation
          is the signal that work is in progress. */}
      <div className="relative h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 w-1/3 rounded-full"
          style={{
            background: GRADIENTS.horizontal,
            animation: 'vaacha-progress 1.4s ease-in-out infinite',
          }}
        />
      </div>

      {/* Step pills, lit progressively as the phase advances. Tiny dot
          icon turns into a check when the step is complete. */}
      <div className="flex items-center justify-between gap-1 text-[11px]">
        {STEPS.map((step, i) => {
          const done = currentIdx > i
          const active = currentIdx === i
          return (
            <div
              key={step.key}
              className={`flex items-center gap-1.5 font-medium ${
                done ? 'text-emerald-600' : active ? 'text-[#7C3AED]' : 'text-slate-400'
              }`}
            >
              <span className={`inline-block w-2 h-2 rounded-full ${
                done ? 'bg-emerald-500' : active ? 'bg-[#7C3AED] animate-pulse' : 'bg-slate-300'
              }`} />
              {step.label}
            </div>
          )
        })}
      </div>
    </div>
  )
}

async function pollJob(jobId, intervalMs = 1000, maxAttempts = 120, onStatus) {
  let lastStatus = null
  for (let i = 0; i < maxAttempts; i++) {
    const job = await api(`/jobs/${jobId}`)
    if (job.status !== lastStatus) {
      lastStatus = job.status
      try { onStatus?.(job.status) } catch { /* status callbacks are best-effort */ }
    }
    if (job.status === 'ready') return job
    if (job.status === 'failed') throw new Error(job.error || 'Job failed.')
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('Timed out waiting for transcription.')
}
