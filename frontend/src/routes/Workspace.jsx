import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import VideoCanvas from '../components/VideoCanvas'
import SubtitleSidebar from '../components/SubtitleSidebar'
import DesignControls from '../components/DesignControls'
import { useWorkspace } from '../hooks/useWorkspace'
import { DEFAULT_STYLE, loadSavedStyle, LS_STYLE } from '../lib/defaultStyle'

/**
 * /projects/:id — the editor for a single job. Loads via useWorkspace,
 * renders the same 3-column layout as the legacy App.jsx, but URL-driven
 * so links are shareable and refresh always lands on the right project.
 */
export default function Workspace() {
  const { id } = useParams()
  const navigate = useNavigate()
  const ws = useWorkspace({ initialJobId: id })

  const [styleSchema, setStyleSchema] = useState(loadSavedStyle)

  // Persist style on change.
  useEffect(() => {
    try { localStorage.setItem(LS_STYLE, JSON.stringify(styleSchema)) } catch { /* quota */ }
  }, [styleSchema])

  // If the load failed (deleted job, network blip), bounce back to the list.
  // Show a brief inline message first so it's not silent.
  useEffect(() => {
    if (ws.restoreError) {
      const t = setTimeout(() => navigate('/projects', { replace: true }), 1500)
      return () => clearTimeout(t)
    }
  }, [ws.restoreError, navigate])

  if (ws.restoring) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-slate-500">Loading project…</p>
      </div>
    )
  }
  if (ws.restoreError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-rose-600">
          Could not load this project: {ws.restoreError}. Redirecting…
        </p>
      </div>
    )
  }
  if (!ws.videoUrl) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Link to="/projects" className="text-sm text-slate-600 underline">
          Project not available — back to Projects
        </Link>
      </div>
    )
  }

  return (
    <main className="flex-1 grid grid-cols-[minmax(16rem,22%)_1fr_minmax(18rem,28%)] gap-0 min-h-0 bg-white">
      <section className="border-r border-slate-200 overflow-y-auto min-h-0 bg-slate-50">
        <SubtitleSidebar
          segments={ws.segments}
          originalSegments={ws.originalSegments}
          activeIndex={ws.activeIndex}
          onSelect={ws.setActiveIndex}
          onEdit={ws.editSegments}
          style={styleSchema}
        />
      </section>
      <section className="flex items-center justify-center bg-slate-900 min-h-0 p-4">
        <VideoCanvas
          videoUrl={ws.videoUrl}
          segments={ws.segments}
          activeIndex={ws.activeIndex}
          onActiveChange={ws.setActiveIndex}
          style={styleSchema}
          jobId={ws.jobId}
        />
      </section>
      <section className="border-l border-slate-200 overflow-y-auto min-h-0 bg-white">
        <DesignControls value={styleSchema} onChange={setStyleSchema} segments={ws.segments} />
      </section>
    </main>
  )
}
