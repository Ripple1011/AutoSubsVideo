import { useState } from 'react'
import VideoCanvas from './components/VideoCanvas'
import SubtitleSidebar from './components/SubtitleSidebar'
import DesignControls from './components/DesignControls'
import SettingsModal from './components/SettingsModal'
import DropZone from './components/DropZone'

const DEFAULT_STYLE = {
  font: 'Montserrat Black',
  textColor: '#ffffff',
  outlineColor: '#000000',
  highlightColor: '#aa3bff',
  scale: 1.0,
  verticalAlignment: 'bottom',   // 'top' | 'center' | 'bottom'
  animation: 'fade',             // 'none' | 'fade' | 'slide' | 'pop'
  animationSpeed: 'normal',      // 'fast' | 'normal' | 'slow'
}

export default function App() {
  const [videoUrl, setVideoUrl] = useState(null)
  const [segments, setSegments] = useState([])
  const [styleSchema, setStyleSchema] = useState(DEFAULT_STYLE)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const inWorkspace = videoUrl !== null

  return (
    <div className="h-full w-full flex flex-col bg-[#0b0b0f] text-white">
      <header className="px-6 py-3 border-b border-white/10 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">AutoSub</h1>
        <button className="text-sm text-white/60 hover:text-white" onClick={() => setSettingsOpen(true)}>
          ⚙ Settings
        </button>
      </header>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {!inWorkspace ? (
        <DropZone onReady={({ videoUrl, segments }) => { setVideoUrl(videoUrl); setSegments(segments); setActiveIndex(-1) }} />
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

