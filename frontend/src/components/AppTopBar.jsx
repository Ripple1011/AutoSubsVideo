import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { BRAND, GRADIENTS, LOGO } from '../lib/brand'
import SettingsModal from './SettingsModal'
import ExportMenu from './ExportMenu'
import CreditsBadge from './CreditsBadge'
import { loadSavedStyle } from '../lib/defaultStyle'

/**
 * The persistent top bar shown on every authed page.
 *
 * Extracted out of App.jsx so routes that need their own layout (e.g.,
 * /pricing which is mounted outside the App shell so logged-out users
 * can also reach it) can still render the same top bar when the visitor
 * IS authed. Routes inside <App> use AppTopBar via App; standalone
 * routes call <AppTopBar /> directly inside an `if (user) {}` branch.
 *
 * Editor-only items (Export) only render on /projects/:id workspace
 * routes — they need a live job id.
 */
export default function AppTopBar() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  // Detect workspace route — we need the live job id to wire ExportMenu.
  const workspaceMatch = location.pathname.match(/^\/projects\/([^/]+)$/)
  const workspaceId = workspaceMatch && workspaceMatch[1] !== 'new' ? workspaceMatch[1] : null

  // ExportMenu wants the current style schema. Pull it lazily from
  // localStorage — Workspace.jsx writes there continuously.
  const styleSchema = workspaceId ? loadSavedStyle() : null

  return (
    <header className="px-6 py-3 border-b border-slate-200 bg-white flex items-center justify-between flex-shrink-0">
      <Link to="/projects" className="flex items-center" title={BRAND.name}>
        <img src={LOGO.full} alt={BRAND.name} className="h-12 w-auto block" />
      </Link>
      <div className="flex items-center gap-5 text-sm">
        <Link to="/projects" className="text-slate-600 hover:text-slate-900 font-medium">
          My Projects
        </Link>
        {/* Logged-in CTA: prompt to buy more credits (action-oriented).
            Logged-out users see this through Pricing on the public chrome,
            so we don't render anything here for the (rare) logged-out
            visitor who somehow landed on an authed-only page. */}
        {user && (
          <Link
            to="/pricing"
            className="text-[#7C3AED] hover:text-[#6D28D9] font-semibold"
          >
            🪙 Buy credits
          </Link>
        )}
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
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  )
}
