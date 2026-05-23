import { useCallback, useEffect, useState } from 'react'
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
  const [jobId, setJobId] = useState(null)
  const [styleSchema, setStyleSchema] = useState(loadSavedStyle)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // restoring is true ONLY when there's a saved jobId on first mount, so
  // fresh sessions land directly on the DropZone without a flicker.
  const [restoring, setRestoring] = useState(() => Boolean(localStorage.getItem(LS_JOB)))

  // Load a job from the backend into the workspace. Shared between mount-
  // time restore and the Recent Videos picker. Throws if the job isn't
  // in a renderable shape (not ready, no segments).
  const loadJob = useCallback(async (id) => {
    const job = await api(`/jobs/${id}`)
    if (job.status !== 'ready' || !Array.isArray(job.segments) || job.segments.length === 0) {
      throw new Error('Job not ready')
    }
    setSegments(job.segments)
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

  const handleReady = ({ videoUrl, segments, jobId: newJobId }) => {
    setVideoUrl(videoUrl)
    setSegments(segments)
    setJobId(newJobId)
    setActiveIndex(-1)
    if (newJobId) {
      try { localStorage.setItem(LS_JOB, newJobId) } catch { /* quota */ }
    }
  }

  const handleNewVideo = () => {
    setVideoUrl(null)
    setSegments([])
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
              activeIndex={activeIndex}
              onSelect={setActiveIndex}
              onEdit={setSegments}
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
            <DesignControls value={styleSchema} onChange={setStyleSchema} />
          </section>
        </main>
      )}
    </div>
  )
}
