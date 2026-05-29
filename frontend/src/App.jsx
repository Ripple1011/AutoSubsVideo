import { Outlet } from 'react-router-dom'
import AppTopBar from './components/AppTopBar'
import AppFooter from './components/AppFooter'

/**
 * App shell. Persistent top bar + footer + <Outlet/> for the active route.
 * Light-themed throughout (Slice 6); the 9:16 video canvas inside Workspace
 * stays dark by design.
 *
 * The top bar and footer are extracted to standalone components so
 * standalone routes (e.g., /pricing mounted outside the App shell so
 * logged-out visitors can reach it) can compose them when needed.
 */
export default function App() {
  return (
    <div className="h-full w-full flex flex-col bg-white text-slate-900">
      <AppTopBar />
      <div className="flex-1 min-h-0 flex flex-col">
        <Outlet />
      </div>
      <AppFooter />
    </div>
  )
}
