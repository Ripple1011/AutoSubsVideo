import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import ProjectsList from './routes/ProjectsList.jsx'
import NewProject from './routes/NewProject.jsx'
import Workspace from './routes/Workspace.jsx'
import Login from './routes/Login.jsx'
import Pricing from './routes/Pricing.jsx'
import Account from './routes/Account.jsx'
import AdminPlans from './routes/AdminPlans.jsx'
import Landing from './routes/Landing.jsx'
import Privacy from './routes/Privacy.jsx'
import Terms from './routes/Terms.jsx'
import RequireAuth from './components/RequireAuth.jsx'

/**
 * Route layout (Slice 5a — brand + landing):
 *
 *   PUBLIC (no auth required):
 *     /            → Landing page (redirects to /projects if logged in)
 *     /login       → Google OAuth button
 *     /privacy     → privacy policy
 *     /terms       → terms of service
 *
 *   AUTHED (RequireAuth gate):
 *     /projects          → grid
 *     /projects/new      → upload flow
 *     /projects/:id      → editor
 *     /pricing           → plan cards (also accessible logged out via the
 *                          Landing pricing teaser linking here)
 *     /account           → user dashboard
 *     /admin/plans       → plan management (superuser only inside the route)
 *     *                  → redirect to /projects
 *
 * Pricing is currently authed because it's wrapped inside App's shell (which
 * shows the credit badge). The Landing page has its own teaser cards so
 * logged-out users still get pricing info; the deep /pricing route is for
 * users actively buying.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Public marketing + legal */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />

        {/* Pricing is dual-mode: public visitors see plans + Buy buttons
            that route them to /login; logged-in users see the same page
            inside the App shell. To support both, we mount it twice --
            once outside auth without the App chrome, once inside auth
            with it. */}
        <Route path="/pricing" element={<Pricing />} />

        {/* Authed application */}
        <Route element={<RequireAuth />}>
          <Route element={<App />}>
            <Route path="/projects" element={<ProjectsList />} />
            <Route path="/projects/new" element={<NewProject />} />
            <Route path="/projects/:id" element={<Workspace />} />
            <Route path="/account" element={<Account />} />
            <Route path="/admin/plans" element={<AdminPlans />} />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
