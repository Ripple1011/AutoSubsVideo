import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import ProjectsList from './routes/ProjectsList.jsx'
import NewProject from './routes/NewProject.jsx'
import Workspace from './routes/Workspace.jsx'
import Login from './routes/Login.jsx'
import RequireAuth from './components/RequireAuth.jsx'

/**
 * Route layout (Slice 2 — auth):
 *   /login             → public (Google OAuth button)
 *   --- below require an active session ---
 *   /                  → redirect to /projects
 *   /projects          → grid
 *   /projects/new      → upload flow
 *   /projects/:id      → editor
 *   *                  → redirect to /projects
 *
 * RequireAuth wraps everything except /login: it probes /users/me; on 401
 * it bounces to /login carrying the originally-requested path so we land
 * back here after the Google round-trip.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth />}>
          <Route element={<App />}>
            <Route index element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectsList />} />
            <Route path="/projects/new" element={<NewProject />} />
            <Route path="/projects/:id" element={<Workspace />} />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
