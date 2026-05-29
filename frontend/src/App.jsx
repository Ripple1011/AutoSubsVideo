import { useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import SettingsModal from './components/SettingsModal'
import RecentVideosMenu from './components/RecentVideosMenu'
import ExportMenu from './components/ExportMenu'
import CreditsBadge from './components/CreditsBadge'
import { loadSavedStyle } from './lib/defaultStyle'
import { useAuth } from './hooks/useAuth'
import { BRAND, GRADIENTS, LOGO } from './lib/brand'

/**
 * App shell. Persistent top bar + <Outlet/> for the active route. The
 * editor-specific header items (Export, Recent) only render on a
 * /projects/:id workspace route — they need a live jobId.
 *
 * Slice 6: authed app is light-themed for brand consistency with the
 * public landing. The 9:16 video canvas inside the workspace stays
 * dark (it mimics phone playback); everything else around it — top bar,
 * sidebars, design controls, modals — is light.
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
    <div className="h-full w-full flex flex-col bg-white text-slate-900">
      <header className="px-6 py-3 border-b border-slate-200 bg-white flex items-center justify-between flex-shrink-0">
        <Link to="/projects" className="flex items-center" title={BRAND.name}>
          {/* Logo now sits directly on the white app bg — no plate
              needed since the wordmark is navy. */}
          <img src={LOGO.full} alt={BRAND.name} className="h-12 w-auto block" />
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link
            to="/projects/new"
            style={{ background: GRADIENTS.horizontal }}
            className="px-4 py-1.5 rounded-full text-white text-sm font-semibold shadow-md hover:shadow-lg transition-shadow"
          >
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
          {user && <CreditsBadge />}
          <button
            className="text-slate-600 hover:text-slate-900"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙ Settings
          </button>
          {user && (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-100"
                title={user.email}
              >
                <span
                  className="w-7 h-7 rounded-full text-white flex items-center justify-center text-xs font-semibold"
                  style={{ background: GRADIENTS.horizontal }}
                >
                  {(user.email || '?').charAt(0).toUpperCase()}
                </span>
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 mt-1 w-56 rounded-xl border border-slate-200 bg-white shadow-lg z-30 overflow-hidden">
                  <div className="px-3 py-2 text-xs text-slate-500 border-b border-slate-200 truncate">
                    {user.email}
                  </div>
                  <button
                    onClick={() => { setUserMenuOpen(false); navigate('/account') }}
                    className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    Account & credits
                  </button>
                  <button
                    onClick={() => { setUserMenuOpen(false); navigate('/pricing') }}
                    className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    Pricing
                  </button>
                  {user.is_superuser && (
                    <button
                      onClick={() => { setUserMenuOpen(false); navigate('/admin/plans') }}
                      className="block w-full text-left px-3 py-2 text-sm text-[#7C3AED] font-semibold hover:bg-slate-100 border-t border-slate-200"
                    >
                      Manage plans (admin)
                    </button>
                  )}
                  <button
                    onClick={() => { setUserMenuOpen(false); handleLogout() }}
                    className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 border-t border-slate-200"
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
