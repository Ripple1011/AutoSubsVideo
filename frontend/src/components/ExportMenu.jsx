import { useEffect, useRef, useState } from 'react'

/**
 * Header dropdown offering SRT / VTT sidecar downloads plus a burned-in
 * .mp4 render. Sidecars are anchor hrefs (browser handles download via
 * Content-Disposition). The burn is a POST with the live style schema
 * and a busy state covering the FFmpeg pass.
 */
export default function ExportMenu({ jobId, styleSchema }) {
  const [open, setOpen] = useState(false)
  const [burning, setBurning] = useState(false)
  const [error, setError] = useState(null)
  const wrapperRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!jobId) return null

  const linkFor = (fmt) => `/api/export/soft?job_id=${encodeURIComponent(jobId)}&fmt=${fmt}`

  const handleBurn = async () => {
    setBurning(true)
    setError(null)
    try {
      const res = await fetch(`/api/export/hard?job_id=${encodeURIComponent(jobId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(styleSchema || {}),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      // FastAPI's FileResponse sets Content-Disposition with `filename=...`
      // — extract it so the download keeps the user's original name + (subs).
      const cd = res.headers.get('content-disposition') || ''
      const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i)
      const filename = match ? decodeURIComponent(match[1]) : 'burned.mp4'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setOpen(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setBurning(false)
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button onClick={() => setOpen((v) => !v)} className="text-white/60 hover:text-white">
        ↓ Export
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-[#15151c] border border-white/10 rounded-lg shadow-xl z-50 py-1">
          {[
            { fmt: 'srt', label: 'Download .srt', sub: 'SubRip — for YouTube uploads, editors' },
            { fmt: 'vtt', label: 'Download .vtt', sub: 'WebVTT — for web players' },
          ].map((opt) => (
            <a
              key={opt.fmt}
              href={linkFor(opt.fmt)}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 hover:bg-white/5 text-sm"
            >
              <div className="text-white">{opt.label}</div>
              <div className="text-[11px] text-white/40">{opt.sub}</div>
            </a>
          ))}
          <div className="border-t border-white/10 my-1" />
          <button
            onClick={handleBurn}
            disabled={burning}
            className="block w-full text-left px-3 py-2 hover:bg-white/5 text-sm disabled:opacity-50"
          >
            <div className="text-white">
              {burning ? 'Rendering…' : 'Render video (burned-in)'}
            </div>
            <div className="text-[11px] text-white/40">
              {burning ? 'FFmpeg is overlaying subtitles' : 'New .mp4 with subtitles on every frame'}
            </div>
          </button>
          {error && (
            <div className="mx-2 my-1 px-2 py-1 text-[11px] rounded bg-rose-500/20 text-rose-200">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
