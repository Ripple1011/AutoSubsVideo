import { useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import SettingsModal from './components/SettingsModal'
import RecentVideosMenu from './components/RecentVideosMenu'
import ExportMenu from './components/ExportMenu'
import { loadSavedStyle } from './lib/defaultStyle'
import { useAuth } from './hooks/useAuth'

/**
 * App shell. Persistent top bar + <Outlet/> for the active route. The
 * editor-specific header items (Export, Recent) only render on a
 * /projects/:id workspace route — they need a live jobId.
 */
export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  // Detect workspace route by URL pattern. We don't pull `useParams` here
  // because App is mounted ABOVE the route definitions — useParams would
  // return {}. A pathname match is fine; the route component itself owns
  // the heavy lifting of validating the id.
  const workspaceMatch = location.pathname.match(/^\/projects\/([^/]+)$/)
  const workspaceId = workspaceMatch && workspaceMatch[1] !== 'new' ? workspaceMatch[1] : null

  // ExportMenu needs the current style schema — read straight from
  // localStorage so the header doesn't need to thread it down from the
  // Workspace route. The user's most recent style choices are persisted
  // there continuously by Workspace.jsx.
  const styleSchema = workspaceId ? loadSavedStyle() : null

  const handlePickRecent = (id) => {
    if (id && id !== workspaceId) navigate(`/projects/${id}`)
  }

  const handleDeleteRecent = (id) => {
    // If the user deleted the currently-open job, bounce out to the list.
    if (id === workspaceId) navigate('/projects', { replace: true })
  }

  return (
    <div className="h-full w-full flex flex-col bg-[#0b0b0f] text-white">
      <header className="px-6 py-3 border-b border-white/10 flex items-center justify-between flex-shrink-0">
        <Link to="/projects" className="text-lg font-semibold tracking-tight">AutoSub</Link>
        <div className="flex items-center gap-4 text-sm">
          <Link to="/projects/new" className="text-white/60 hover:text-white">
            ＋ New Video
          </Link>
          {workspaceId && (
            <ExportMenu jobId={workspaceId} styleSchema={styleSchema} />
          )}
          <RecentVideosMenu
            currentJobId={workspaceId}
            onPick={handlePickRecent}
            onDelete={handleDeleteRecent}
          />
          <button className="text-white/60 hover:text-white" onClick={() => setSettingsOpen(true)}>
            ⚙ Settings
          </button>
          {user && (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5"
                title={user.email}
              >
                <span className="w-7 h-7 rounded-full bg-purple-500 text-white flex items-center justify-center text-xs font-semibold">
                  {(user.email || '?').charAt(0).toUpperCase()}
                </span>
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 mt-1 w-56 rounded border border-white/10 bg-[#16161d] shadow-lg z-30">
                  <div className="px-3 py-2 text-xs text-white/60 border-b border-white/10 truncate">
                    {user.email}
                  </div>
                  <button
                    onClick={() => { setUserMenuOpen(false); handleLogout() }}
                    className="block w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/5"
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <div className="flex-1 min-h-0 flex flex-col">
        <Outlet />
      </div>
    </div>
  )
}
