import { useEffect, useRef, useState } from 'react'

/**
 * Header dropdown offering SRT / VTT download for the loaded job.
 *
 * The actual download is a plain anchor href — backend sends
 * Content-Disposition: attachment so the browser saves the file
 * without navigating away. No fetch / state plumbing needed.
 */
export default function ExportMenu({ jobId }) {
  const [open, setOpen] = useState(false)
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

  return (
    <div ref={wrapperRef} className="relative">
      <button onClick={() => setOpen((v) => !v)} className="text-white/60 hover:text-white">
        ↓ Export
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-44 bg-[#15151c] border border-white/10 rounded-lg shadow-xl z-50 py-1">
          {[
            { fmt: 'srt', label: 'Download .srt', sub: 'SubRip subtitle' },
            { fmt: 'vtt', label: 'Download .vtt', sub: 'WebVTT subtitle' },
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
        </div>
      )}
    </div>
  )
}
