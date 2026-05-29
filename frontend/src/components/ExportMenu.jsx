import { useEffect, useRef, useState } from 'react'
import RenderPreviewModal from './RenderPreviewModal'
import { track } from '../lib/analytics'

/**
 * Header dropdown offering SRT / VTT sidecar downloads plus a burned-in
 * .mp4 render. Sidecars are anchor hrefs (browser handles download via
 * Content-Disposition). The burn is a POST with the live style schema;
 * on success the resulting mp4 is shown in RenderPreviewModal so the
 * user can review (and use native fullscreen, which works because the
 * subtitles are baked into the pixels) before deciding to download.
 */
export default function ExportMenu({ jobId, styleSchema }) {
  const [open, setOpen] = useState(false)
  const [burning, setBurning] = useState(false)
  const [error, setError] = useState(null)
  // Preview state — set after a successful burn. Holds the blob URL and
  // the filename extracted from Content-Disposition.
  const [preview, setPreview] = useState(null)   // { url, filename } | null
  const wrapperRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Revoke the blob URL on unmount or when a new preview replaces it.
  // Without this, every successful render leaks a multi-MB blob in memory.
  useEffect(() => {
    return () => { if (preview?.url) URL.revokeObjectURL(preview.url) }
  }, [preview])

  if (!jobId) return null

  const linkFor = (fmt) => `/api/export/soft?job_id=${encodeURIComponent(jobId)}&fmt=${fmt}`

  const handleBurn = async () => {
    setBurning(true)
    setError(null)
    track('export_burn_started', { job_id: jobId })
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
      const cd = res.headers.get('content-disposition') || ''
      const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i)
      const filename = match ? decodeURIComponent(match[1]) : 'burned.mp4'
      // Release any previous preview before allocating the new blob URL.
      if (preview?.url) URL.revokeObjectURL(preview.url)
      const url = URL.createObjectURL(blob)
      setPreview({ url, filename })
      track('export_burn_succeeded', { job_id: jobId })
      setOpen(false)
    } catch (e) {
      track('export_burn_failed', { job_id: jobId, error: e.message })
      setError(e.message)
    } finally {
      setBurning(false)
    }
  }

  const handleDownload = () => {
    if (!preview) return
    const a = document.createElement('a')
    a.href = preview.url
    a.download = preview.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const handleClose = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button onClick={() => setOpen((v) => !v)} className="text-slate-600 hover:text-slate-900">
        ↓ Export
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1 overflow-hidden">
          {[
            { fmt: 'srt', label: 'Download .srt', sub: 'SubRip — for YouTube uploads, editors' },
            { fmt: 'vtt', label: 'Download .vtt', sub: 'WebVTT — for web players' },
          ].map((opt) => (
            <a
              key={opt.fmt}
              href={linkFor(opt.fmt)}
              onClick={() => { track('export_soft', { job_id: jobId, fmt: opt.fmt }); setOpen(false) }}
              className="block px-3 py-2 hover:bg-slate-50 text-sm"
            >
              <div className="text-slate-900">{opt.label}</div>
              <div className="text-[11px] text-slate-500">{opt.sub}</div>
            </a>
          ))}
          <div className="border-t border-slate-200 my-1" />
          <button
            onClick={handleBurn}
            disabled={burning}
            className="block w-full text-left px-3 py-2 hover:bg-slate-50 text-sm disabled:opacity-50"
          >
            <div className="text-slate-900">
              {burning ? 'Rendering…' : 'Preview burned video'}
            </div>
            <div className="text-[11px] text-slate-500">
              {burning ? 'FFmpeg is overlaying subtitles' : 'Render, watch, then download .mp4'}
            </div>
          </button>
          {error && (
            <div className="mx-2 my-1 px-2 py-1 text-[11px] rounded bg-rose-50 text-rose-700 border border-rose-200">
              {error}
            </div>
          )}
        </div>
      )}

      <RenderPreviewModal
        open={Boolean(preview)}
        videoUrl={preview?.url}
        filename={preview?.filename}
        onDownload={handleDownload}
        onClose={handleClose}
      />
    </div>
  )
}
