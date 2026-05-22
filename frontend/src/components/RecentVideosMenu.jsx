import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/apiClient'

/**
 * Header dropdown listing recent jobs from the backend. Click a row to
 * restore that job into the workspace; click the ✕ to delete (with confirm).
 *
 * The list is fetched lazily on open, and re-fetched after each delete so
 * stale rows never linger. Parent (App) controls what "restore" actually
 * does via the onPick callback — the menu itself stays presentational.
 */
export default function RecentVideosMenu({ currentJobId, onPick, onDelete }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(null)   // null = not loaded yet
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const wrapperRef = useRef(null)

  // Outside-click closes the menu — no overlay needed.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const refresh = async () => {
    setError(null)
    try {
      const list = await api('/jobs?limit=20')
      setItems(list)
    } catch (e) {
      setError(e.message)
      setItems([])
    }
  }

  const handleToggle = async () => {
    const next = !open
    setOpen(next)
    if (next && items === null) await refresh()
  }

  const handlePick = (id) => {
    setOpen(false)
    onPick(id)
  }

  const handleDelete = async (e, id, filename) => {
    e.stopPropagation()
    if (!confirm(`Delete "${filename || id}" — video + transcription?`)) return
    setBusyId(id)
    try {
      await api(`/jobs/${id}`, { method: 'DELETE' })
      onDelete?.(id)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button onClick={handleToggle} className="text-white/60 hover:text-white">
        ▾ Recent
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[min(28rem,90vw)] bg-[#15151c] border border-white/10 rounded-lg shadow-xl z-50">
          <div className="px-3 py-2 border-b border-white/10 text-xs text-white/40 uppercase tracking-wide">
            Recent uploads
          </div>
          {items === null ? (
            <div className="px-3 py-4 text-sm text-white/40">Loading…</div>
          ) : error ? (
            <div className="px-3 py-4 text-sm text-rose-300">{error}</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-4 text-sm text-white/40">No previous uploads.</div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {items.map((j) => (
                <li
                  key={j.id}
                  onClick={() => handlePick(j.id)}
                  className={`group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/5 ${
                    j.id === currentJobId ? 'bg-purple-500/10' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">
                      {j.filename || j.id}
                    </div>
                    <div className="text-[11px] text-white/40 mt-0.5 flex items-center gap-2">
                      <StatusBadge status={j.status} />
                      <span>{j.num_segments} segs</span>
                      <span>·</span>
                      <span>{formatStamp(j.created_at)}</span>
                      {j.language && j.language !== 'auto' && (
                        <>
                          <span>·</span>
                          <span className="uppercase">{j.language}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, j.id, j.filename)}
                    disabled={busyId === j.id}
                    className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-rose-300 px-2 py-1 text-xs disabled:opacity-30"
                    title="Delete this video + transcription"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }) {
  const tone = {
    ready: 'bg-emerald-500/20 text-emerald-200',
    failed: 'bg-rose-500/20 text-rose-200',
    extracting: 'bg-amber-500/20 text-amber-200',
    transcribing: 'bg-amber-500/20 text-amber-200',
    queued: 'bg-white/10 text-white/60',
  }[status] || 'bg-white/10 text-white/60'
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${tone}`}>
      {status || '?'}
    </span>
  )
}

function formatStamp(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const today = new Date()
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    return sameDay
      ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return '—'
  }
}
