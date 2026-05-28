import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/apiClient'

/**
 * Encapsulates everything an editor route needs to manage one job:
 * load it, restore segments + video, auto-save edits, run undo/redo.
 *
 * Used by:
 *   - the legacy single-state App.jsx (still works, no behavior change)
 *   - the new /projects/:id route, which passes a jobId and gets a fully
 *     wired workspace back.
 *
 * Inputs:
 *   - initialJobId: when provided (route param), the hook loads it on mount.
 *   - autoRestoreFromStorage: when true (legacy App.jsx), the hook also
 *     consults localStorage.autosub.jobId and rehydrates. Routes set this
 *     false because the URL is the source of truth.
 */
export const LS_JOB = 'autosub.jobId'
export const LS_STYLE = 'autosub.style'
const UNDO_STACK_LIMIT = 50

export function useWorkspace({ initialJobId = null, autoRestoreFromStorage = false } = {}) {
  const [videoUrl, setVideoUrl] = useState(null)
  const [segments, setSegments] = useState([])
  const [originalSegments, setOriginalSegments] = useState([])
  const [jobId, setJobId] = useState(initialJobId)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [restoring, setRestoring] = useState(() => {
    if (initialJobId) return true
    if (autoRestoreFromStorage) {
      try { return Boolean(localStorage.getItem(LS_JOB)) } catch { return false }
    }
    return false
  })
  const [restoreError, setRestoreError] = useState(null)

  // Ref to the segments value most recently round-tripped through the
  // backend. Used by the auto-save effect to skip a PATCH when the current
  // segments array is just what we last loaded from / saved to the server.
  const lastPersistedRef = useRef(null)

  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])

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

  // Load a job from the backend into the workspace. Shared between mount-time
  // restore, /projects/:id navigation, and the Recent picker.
  const loadJob = useCallback(async (id) => {
    const job = await api(`/jobs/${id}`)
    if (job.status !== 'ready' || !Array.isArray(job.segments) || job.segments.length === 0) {
      throw new Error('Job not ready')
    }
    setSegments(job.segments)
    setOriginalSegments(job.segments_original ?? job.segments)
    lastPersistedRef.current = job.segments
    setPast(Array.isArray(job.segments_history) ? job.segments_history : [])
    setFuture([])
    setVideoUrl(`/api/jobs/${id}/video`)
    setJobId(id)
    setActiveIndex(-1)
    try { localStorage.setItem(LS_JOB, id) } catch { /* quota */ }
  }, [])

  // Mount-time load. Two sources of "which job to load":
  //   1. `initialJobId` from a route param — used by /projects/:id.
  //   2. localStorage.autosub.jobId — used by the legacy single-state App.
  // We don't load from both: if initialJobId is set, it wins.
  useEffect(() => {
    let cancelled = false
    async function run() {
      const target = initialJobId || (autoRestoreFromStorage ? localStorage.getItem(LS_JOB) : null)
      if (!target) return
      try {
        await loadJob(target)
      } catch (e) {
        if (cancelled) return
        setRestoreError(e.message)
        if (!initialJobId) {
          try { localStorage.removeItem(LS_JOB) } catch { /* quota */ }
        }
      } finally {
        if (!cancelled) setRestoring(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [initialJobId, autoRestoreFromStorage, loadJob])

  // Cmd+Z / Cmd+Shift+Z (Ctrl+Z / Ctrl+Y on non-Mac).
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

  // Auto-save edits (text / timing). Debounced 500 ms.
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
        console.warn('[autosub] auto-save failed:', e.message)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [segments, jobId])

  const handleReady = useCallback(({ videoUrl, segments, jobId: newJobId }) => {
    setVideoUrl(videoUrl)
    setSegments(segments)
    setOriginalSegments(segments)
    lastPersistedRef.current = segments
    setPast([])
    setFuture([])
    setJobId(newJobId)
    setActiveIndex(-1)
    if (newJobId) {
      try { localStorage.setItem(LS_JOB, newJobId) } catch { /* quota */ }
    }
  }, [])

  const handleNewVideo = useCallback(() => {
    setVideoUrl(null)
    setSegments([])
    setOriginalSegments([])
    setPast([])
    setFuture([])
    setJobId(null)
    setActiveIndex(-1)
    try { localStorage.removeItem(LS_JOB) } catch { /* quota */ }
  }, [])

  return {
    // state
    videoUrl, segments, originalSegments, jobId, activeIndex,
    restoring, restoreError,
    pastCount: past.length, futureCount: future.length,
    // setters / actions
    setActiveIndex,
    editSegments,
    undo, redo,
    loadJob,
    handleReady,
    handleNewVideo,
  }
}
