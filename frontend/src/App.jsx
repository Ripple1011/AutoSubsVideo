import { useEffect, useState } from 'react'
import VideoCanvas from './components/VideoCanvas'
import SubtitleSidebar from './components/SubtitleSidebar'
import DesignControls from './components/DesignControls'
import SettingsModal from './components/SettingsModal'
import DropZone from './components/DropZone'
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

  // Mount-time restore. If a previous jobId is in localStorage, try to
  // fetch the job; on success, rehydrate segments + point the <video>
  // at the backend's source. Any failure (404, not ready, network error)
  // clears the stale key and lands the user on the DropZone.
  useEffect(() => {
    const saved = localStorage.getItem(LS_JOB)
    if (!saved) return
    let cancelled = false
    ;(async () => {
      try {
        const job = await api(`/jobs/${saved}`)
        if (cancelled) return
        if (job.status === 'ready' && Array.isArray(job.segments) && job.segments.length > 0) {
          setSegments(job.segments)
          setVideoUrl(`/api/jobs/${saved}/video`)
          setJobId(saved)
        } else {
          localStorage.removeItem(LS_JOB)
        }
      } catch {
        if (!cancelled) localStorage.removeItem(LS_JOB)
      } finally {
        if (!cancelled) setRestoring(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

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
        <main className="flex-1 grid grid-cols-2 gap-0 min-h-0">
          <section className="border-r border-white/10 overflow-y-auto">
            <SubtitleSidebar
              segments={segments}
              activeIndex={activeIndex}
              onSelect={setActiveIndex}
              onEdit={setSegments}
            />
          </section>
          <section className="flex flex-col min-h-0">
            <div className="flex-1 flex items-center justify-center bg-black/50 min-h-0">
              <VideoCanvas
                videoUrl={videoUrl}
                segments={segments}
                activeIndex={activeIndex}
                onActiveChange={setActiveIndex}
                style={styleSchema}
              />
            </div>
            <div className="border-t border-white/10">
              <DesignControls value={styleSchema} onChange={setStyleSchema} />
            </div>
          </section>
        </main>
      )}
    </div>
  )
}
