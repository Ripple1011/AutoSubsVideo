import { useCallback, useEffect, useRef, useState } from 'react'
import VideoCanvas from './components/VideoCanvas'
import SubtitleSidebar from './components/SubtitleSidebar'
import DesignControls from './components/DesignControls'
import SettingsModal from './components/SettingsModal'
import DropZone from './components/DropZone'
import RecentVideosMenu from './components/RecentVideosMenu'
import ExportMenu from './components/ExportMenu'
import { api } from './lib/apiClient'

const DEFAULT_STYLE = {
  font: 'Montserrat Black',
  textColor: '#ffffff',
  outlineColor: '#000000',
  highlightColor: '#aa3bff',
  highlightTransparent: false,   // when true, no background fill behind subtitle
  speakerColors: {},             // { "Speaker 2": "#ff5599", ... } — per-label overrides
  karaokeEnabled: false,         // light each word as it's spoken via per-word timestamps
  karaokeColor: '#ffe066',       // accent color for the active word when karaoke is on
  scale: 1.0,
  verticalAlignment: 'bottom',   // 'top' | 'center' | 'bottom'
  animation: 'fade',             // 'none' | 'fade' | 'slide' | 'pop'
  animationSpeed: 'normal',      // 'fast' | 'normal' | 'slow'
}

// localStorage keys for workspace persistence. The frontend keeps a pointer
// (jobId) to the last successful upload and the user's style choices; the
// segments and source video are restored from the backend by fetching
// /jobs/{id} and /jobs/{id}/video. Nothing transcription-related is duplicated
// in browser storage.
const LS_JOB = 'autosub.jobId'
const LS_STYLE = 'autosub.style'

function loadSavedStyle() {
  try {
    const raw = localStorage.getItem(LS_STYLE)
    if (!raw) return DEFAULT_STYLE
    // Merge over defaults so new style keys land with their defaults when
    // the user has an older snapshot in storage.
    return { ...DEFAULT_STYLE, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_STYLE
  }
}

export default function App() {
  const [videoUrl, setVideoUrl] = useState(null)
  const [segments, setSegments] = useState([])
  // Snapshot of segments as loaded from the server / fresh upload. SubtitleSidebar's
  // "Reset all" button hands this back through onEdit to undo any in-session edits
  // (text + timing). Reference equality with `segments` tells us whether the user
  // has touched anything — cheap, no deep compare needed.
  const [originalSegments, setOriginalSegments] = useState([])
  const [jobId, setJobId] = useState(null)
  const [styleSchema, setStyleSchema] = useState(loadSavedStyle)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // restoring is true ONLY when there's a saved jobId on first mount, so
  // fresh sessions land directly on the DropZone without a flicker.
  const [restoring, setRestoring] = useState(() => Boolean(localStorage.getItem(LS_JOB)))
  // Reference to the most-recently-persisted segments. Used by the auto-save
  // effect below to skip PATCH when the current segments value is just what
  // we last loaded from / saved to the backend (no real edit happened).
  const lastPersistedRef = useRef(null)

  // Undo/redo stacks. `past` holds previous segments arrays (most recent at
  // end); `future` holds states that have been undone (newest at index 0)
  // and become redo-able with Cmd+Shift+Z. Bounded at UNDO_STACK_LIMIT
  // entries each — older edits drop off so memory doesn't grow unbounded.
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])
  const UNDO_STACK_LIMIT = 50

  // The single funnel for any user-driven segments change (text edits,
  // timing nudges, Reset all). Pushes the outgoing value to `past`, clears
  // `future` (a new edit invalidates the redo trail), then sets the new
  // segments. Programmatic loads from the backend use setSegments directly
  // and bypass this so they don't pollute the stack.
  const editSegments = useCallback((next) => {
    setPast((p) => [...p, segments].slice(-UNDO_STACK_LIMIT))
    setFuture([])
    setSegments(next)
  }, [segments])

  const undo = useCallback(() => {
    if (past.length === 0) return
    const prev = past[past.length - 1]
    setFuture((f) => [segments, ...f].slice(0, UNDO_STACK_LIMIT))
    setPast(past.slice(0, -1))
    setSegments(prev)
  }, [past, segments])

  const redo = useCallback(() => {
    if (future.length === 0) return
    const next = future[0]
    setPast((p) => [...p, segments].slice(-UNDO_STACK_LIMIT))
    setFuture(future.slice(1))
    setSegments(next)
  }, [future, segments])

  // Load a job from the backend into the workspace. Shared between mount-
  // time restore and the Recent Videos picker. Throws if the job isn't
  // in a renderable shape (not ready, no segments).
  const loadJob = useCallback(async (id) => {
    const job = await api(`/jobs/${id}`)
    if (job.status !== 'ready' || !Array.isArray(job.segments) || job.segments.length === 0) {
      throw new Error('Job not ready')
    }
    setSegments(job.segments)
    // originalSegments holds the Gemini-pristine snapshot for the
    // sidebar's "Reset all". After auto-save shipped, the session-loaded
    // segments could already contain edits, so we always prefer the
    // backend's segments_original when present. Older jobs (transcribed
    // before that field existed) fall back to current — Reset becomes
    // a no-op until the first edit triggers a lazy-capture on the
    // backend's PATCH path.
    setOriginalSegments(job.segments_original ?? job.segments)
    // Mark the just-loaded segments as already-persisted so the auto-save
    // effect doesn't immediately PATCH them back to the server.
    lastPersistedRef.current = job.segments
    // Hydrate the undo stack from the backend's bounded edit history so
    // Cmd+Z keeps working across hard refreshes. Backend stores entries
    // oldest-first (push-appends), which is the same shape the in-memory
    // past stack uses, so it can drop in directly. Future is always
    // empty on load (redo only makes sense after an undo within the
    // current session).
    setPast(Array.isArray(job.segments_history) ? job.segments_history : [])
    setFuture([])
    setVideoUrl(`/api/jobs/${id}/video`)
    setJobId(id)
    setActiveIndex(-1)
    try { localStorage.setItem(LS_JOB, id) } catch { /* quota */ }
  }, [])

  // Mount-time restore. If a previous jobId is in localStorage, try to
  // rehydrate via loadJob. Any failure (404, not ready, network error)
  // clears the stale key and lands the user on the DropZone.
  useEffect(() => {
    const saved = localStorage.getItem(LS_JOB)
    if (!saved) return
    let cancelled = false
    ;(async () => {
      try {
        await loadJob(saved)
      } catch {
        if (!cancelled) localStorage.removeItem(LS_JOB)
      } finally {
        if (!cancelled) setRestoring(false)
      }
    })()
    return () => { cancelled = true }
  }, [loadJob])

  // Persist style on every change. Cheap (small JSON, infrequent edits).
  useEffect(() => {
    try { localStorage.setItem(LS_STYLE, JSON.stringify(styleSchema)) } catch { /* quota */ }
  }, [styleSchema])

  // Cmd+Z / Cmd+Shift+Z (Ctrl+Z / Ctrl+Shift+Z on non-Mac) drive the
  // undo/redo stacks. We only preventDefault when there's actually
  // something on the stack — that way browser-native text undo still works
  // inside inputs where our app stack is empty (e.g., Settings modal
  // fields, before any segment has been edited).
  useEffect(() => {
    const handler = (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || !e.key) return
      const k = e.key.toLowerCase()
      const isRedo = (k === 'z' && e.shiftKey) || k === 'y'
      const isUndo = k === 'z' && !e.shiftKey
      if (isUndo && past.length > 0) {
        e.preventDefault()
        undo()
      } else if (isRedo && future.length > 0) {
        e.preventDefault()
        redo()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [past.length, future.length, undo, redo])

  // Auto-save user edits (text / timing) to the backend. Debounced 500 ms so
  // rapid ± clicks coalesce into one PATCH. Skips when there's no job loaded,
  // when segments match what we last loaded / saved (no real change), or
  // when the array is empty. cleanup cancels in-flight timers if segments
  // change again or the user switches jobs.
  useEffect(() => {
    if (!jobId) return
    if (segments === lastPersistedRef.current) return
    if (!segments || segments.length === 0) return
    const capturedJobId = jobId
    const capturedSegments = segments
    const timer = setTimeout(async () => {
      try {
        await api(`/jobs/${capturedJobId}`, {
          method: 'PATCH',
          body: { segments: capturedSegments },
        })
        lastPersistedRef.current = capturedSegments
      } catch (e) {
        // Silent — edits stay in browser state. A future toast could surface
        // this. For now console-only so the UI doesn't nag during transient
        // network blips.
        console.warn('[autosub] auto-save failed:', e.message)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [segments, jobId])

  const handleReady = ({ videoUrl, segments, jobId: newJobId }) => {
    setVideoUrl(videoUrl)
    setSegments(segments)
    setOriginalSegments(segments)
    // Fresh upload — backend already has these segments; don't echo them back.
    lastPersistedRef.current = segments
    setPast([])
    setFuture([])
    setJobId(newJobId)
    setActiveIndex(-1)
    if (newJobId) {
      try { localStorage.setItem(LS_JOB, newJobId) } catch { /* quota */ }
    }
  }

  const handleNewVideo = () => {
    setVideoUrl(null)
    setSegments([])
    setOriginalSegments([])
    setPast([])
    setFuture([])
    setJobId(null)
    setActiveIndex(-1)
    localStorage.removeItem(LS_JOB)
  }

  const handlePickRecent = async (id) => {
    if (id === jobId) return  // already showing this one
    try {
      await loadJob(id)
    } catch (e) {
      alert(`Could not load that job: ${e.message}`)
    }
  }

  const handleDeleteRecent = (id) => {
    // If the user deleted the currently-loaded job, clear the workspace.
    if (id === jobId) handleNewVideo()
  }

  const inWorkspace = videoUrl !== null

  return (
    <div className="h-full w-full flex flex-col bg-[#0b0b0f] text-white">
      <header className="px-6 py-3 border-b border-white/10 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">AutoSub</h1>
        <div className="flex items-center gap-4 text-sm">
          {inWorkspace && (
            <button className="text-white/60 hover:text-white" onClick={handleNewVideo}>
              ＋ New Video
            </button>
          )}
          {inWorkspace && <ExportMenu jobId={jobId} styleSchema={styleSchema} />}
          <RecentVideosMenu
            currentJobId={jobId}
            onPick={handlePickRecent}
            onDelete={handleDeleteRecent}
          />
          <button className="text-white/60 hover:text-white" onClick={() => setSettingsOpen(true)}>
            ⚙ Settings
          </button>
        </div>
      </header>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {restoring ? (
        <main className="flex-1 flex items-center justify-center">
          <p className="text-sm text-white/50">Restoring previous transcription…</p>
        </main>
      ) : !inWorkspace ? (
        <DropZone onReady={handleReady} />
      ) : (
        // Three-column workspace. Center column gives the 9:16 preview its
        // full vertical room (no DesignControls eating its bottom), so the
        // canvas grows naturally on tall screens. Flanking columns scroll
        // independently. Tracks shrink to `minmax(...)` floor on narrow
        // windows so a smaller laptop still gets a usable layout.
        <main className="flex-1 grid grid-cols-[minmax(16rem,22%)_1fr_minmax(18rem,28%)] gap-0 min-h-0">
          <section className="border-r border-white/10 overflow-y-auto min-h-0">
            <SubtitleSidebar
              segments={segments}
              originalSegments={originalSegments}
              activeIndex={activeIndex}
              onSelect={setActiveIndex}
              onEdit={editSegments}
              style={styleSchema}
            />
          </section>
          <section className="flex items-center justify-center bg-black/50 min-h-0 p-4">
            <VideoCanvas
              videoUrl={videoUrl}
              segments={segments}
              activeIndex={activeIndex}
              onActiveChange={setActiveIndex}
              style={styleSchema}
              jobId={jobId}
            />
          </section>
          <section className="border-l border-white/10 overflow-y-auto min-h-0">
            <DesignControls value={styleSchema} onChange={setStyleSchema} segments={segments} />
          </section>
        </main>
      )}
    </div>
  )
}
