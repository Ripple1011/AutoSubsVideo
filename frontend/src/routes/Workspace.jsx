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
  // Mobile tab + viewport hook MUST live above any early-return below or
  // React will see different hook counts between renders (the early-return
  // for restoring/restoreError/!videoUrl fires on the very first render,
  // these wouldn't run, and then on the next render they would).
  const [mobileTab, setMobileTab] = useState('script')   // 'script' | 'style'
  const isMobile = useIsMobile()

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

  // Single mount tree -- VideoCanvas only exists once across mobile/desktop
  // so the underlying <video> blob URL isn't claimed twice.
  const scriptPanel = (
    <SubtitleSidebar
      segments={ws.segments}
      originalSegments={ws.originalSegments}
      activeIndex={ws.activeIndex}
      onSelect={ws.setActiveIndex}
      onEdit={ws.editSegments}
      style={styleSchema}
    />
  )
  const stylePanel = (
    <DesignControls value={styleSchema} onChange={setStyleSchema} segments={ws.segments} />
  )
  const canvas = (
    <VideoCanvas
      videoUrl={ws.videoUrl}
      segments={ws.segments}
      activeIndex={ws.activeIndex}
      onActiveChange={ws.setActiveIndex}
      style={styleSchema}
      jobId={ws.jobId}
    />
  )

  if (isMobile) {
    return (
      <main className="flex-1 flex flex-col min-h-0 bg-white">
        <div
          className="bg-slate-900 flex items-center justify-center p-3 flex-shrink-0 overflow-hidden"
          style={{ height: '45vh' }}
        >
          {canvas}
        </div>
        <div
          className="flex-1 overflow-y-auto min-h-0 border-t border-slate-200"
          style={{ background: mobileTab === 'script' ? '#f8fafc' : '#fff' }}
        >
          {mobileTab === 'script' ? scriptPanel : stylePanel}
        </div>
        <nav className="flex border-t border-slate-200 bg-white flex-shrink-0">
          {[
            { key: 'script', label: 'Script', icon: '📝' },
            { key: 'style', label: 'Style', icon: '🎬' },
          ].map((tab) => {
            const active = mobileTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setMobileTab(tab.key)}
                className={`flex-1 flex flex-col items-center justify-center py-2 text-xs font-medium ${active ? 'text-[#7C3AED]' : 'text-slate-500'}`}
                style={active ? { borderTop: '2px solid #7C3AED', marginTop: '-1px' } : undefined}
              >
                <span className="text-lg leading-none">{tab.icon}</span>
                <span className="mt-0.5">{tab.label}</span>
              </button>
            )
          })}
        </nav>
      </main>
    )
  }

  return (
    <main className="flex-1 grid grid-cols-[minmax(16rem,22%)_1fr_minmax(18rem,28%)] gap-0 min-h-0 bg-white">
      <section className="border-r border-slate-200 overflow-y-auto min-h-0 bg-slate-50">
        {scriptPanel}
      </section>
      <section className="flex items-center justify-center bg-slate-900 min-h-0 p-4">
        {canvas}
      </section>
      <section className="border-l border-slate-200 overflow-y-auto min-h-0 bg-white">
        {stylePanel}
      </section>
    </main>
  )
}

/**
 * Boolean: viewport width is below Tailwind's `lg` breakpoint (1024px).
 * Listens to `matchMedia`'s `change` event so a window resize (or device
 * rotate) flips the layout without a refresh. Defaults to `false` during
 * SSR / first paint so the heavier desktop tree is the default -- on
 * mobile this corrects within one render frame, no flash worth solving.
 */
function useIsMobile() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const onChange = (e) => setMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}
