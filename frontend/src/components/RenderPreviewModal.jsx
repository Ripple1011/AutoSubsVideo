import { useEffect, useRef } from 'react'

/**
 * Full-screen modal that plays the just-rendered burn-in mp4 with native
 * <video> controls. Because the subtitles are baked into the video pixels,
 * the browser's built-in fullscreen button works as expected (no overlay
 * to lose) — the chief reason this modal exists rather than reusing the
 * live VideoCanvas overlay.
 *
 * Caller is responsible for creating + revoking the blob URL. The modal
 * itself is presentational: it just renders the video + footer actions.
 */
export default function RenderPreviewModal({ open, videoUrl, filename, onDownload, onClose }) {
  const videoRef = useRef(null)

  // ESC key closes. Re-binds whenever the modal opens.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Autoplay on open. The browser may block sound; that's fine — user can
  // click play. We don't force muted because they probably want the audio.
  useEffect(() => {
    if (open && videoRef.current) videoRef.current.play().catch(() => {})
  }, [open, videoUrl])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[min(96vw,1100px)] max-h-[min(92vh,900px)] flex flex-col bg-white rounded-xl overflow-hidden border border-slate-200 shadow-2xl"
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-sm text-slate-900 truncate font-medium">{filename || 'Burned video preview'}</div>
            <div className="text-[11px] text-slate-500">Subtitles are baked into the frames — fullscreen shows them.</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 text-lg leading-none px-2">
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 flex items-center justify-center bg-black">
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              controlsList="nodownload"
              className="max-w-full max-h-full"
            />
          ) : (
            <div className="text-white/60 text-sm">No video to preview.</div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded bg-slate-100 hover:bg-slate-200 text-slate-700"
          >
            Close
          </button>
          <button
            onClick={onDownload}
            disabled={!videoUrl}
            className="px-4 py-2 text-sm rounded bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-40 text-white font-medium"
          >
            ↓ Download
          </button>
        </div>
      </div>
    </div>
  )
}
