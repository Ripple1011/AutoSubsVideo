import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import ProjectsList from './routes/ProjectsList.jsx'
import NewProject from './routes/NewProject.jsx'
import Workspace from './routes/Workspace.jsx'

/**
 * Route layout:
 *   /                  → redirect to /projects
 *   /projects          → grid of all jobs (ProjectsList)
 *   /projects/new      → upload flow (NewProject → DropZone)
 *   /projects/:id      → editor (Workspace)
 *   *                  → redirect to /projects
 *
 * App is the persistent shell (top bar + Outlet); all routes render inside.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsList />} />
          <Route path="/projects/new" element={<NewProject />} />
          <Route path="/projects/:id" element={<Workspace />} />
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
