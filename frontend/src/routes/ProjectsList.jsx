import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, jobThumbUrl } from '../lib/apiClient'
import { GRADIENTS } from '../lib/brand'

/**
 * Full-page grid of past jobs. Lives at /projects.
 *
 * The Recent dropdown in the top bar gives a quick 20-item picker; this
 * page is the canonical list view — bigger thumbnails, full timestamps,
 * room to grow (search, filters, bulk delete) as the product matures.
 */

const STATUS_LABEL = {
  queued: 'Queued',
  extracting: 'Extracting',
  transcribing: 'Transcribing',
  ready: 'Ready',
  failed: 'Failed',
}

export default function ProjectsList() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchJobs = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api('/jobs?limit=200')
      setJobs(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchJobs() }, [])

  const handleDelete = async (id) => {
    if (!confirm('Delete this project? The source video and subtitles will be removed permanently.')) return
    try {
      await api(`/jobs/${id}`, { method: 'DELETE' })
      setJobs((js) => js.filter((j) => j.id !== id))
    } catch (e) {
      alert(`Delete failed: ${e.message}`)
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Projects</h2>
          <p className="text-xs text-slate-500 mt-1">
            {jobs.length === 0 ? 'No projects yet.' : `${jobs.length} project${jobs.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <button
          onClick={() => navigate('/projects/new')}
          style={{ background: GRADIENTS.horizontal }} className="px-4 py-2 rounded-full text-white shadow-md hover:shadow-lg transition-shadow font-semibold text-sm"
        >
          + New Project
        </button>
      </div>

      {error && (
        <div className="text-xs rounded px-3 py-2 mb-4 bg-rose-50 border border-rose-200 text-rose-700">
          {error}
        </div>
      )}

      {loading && jobs.length === 0 ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : jobs.length === 0 ? (
        <EmptyState onCreate={() => navigate('/projects/new')} />
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {jobs.map((job) => (
            <ProjectCard
              key={job.id}
              job={job}
              onOpen={() => navigate(`/projects/${job.id}`)}
              onDelete={() => handleDelete(job.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ProjectCard({ job, onOpen, onDelete }) {
  const date = job.created_at ? new Date(job.created_at).toLocaleString() : ''
  const ready = job.status === 'ready'
  return (
    <li className="group relative rounded-xl overflow-hidden bg-white border border-slate-200 hover:border-slate-300 hover:shadow-md transition-all">
      <button onClick={onOpen} disabled={!ready} className="block w-full text-left disabled:cursor-not-allowed">
        <div className="aspect-video bg-slate-900 overflow-hidden relative">
          {ready ? (
            <ThumbImage jobId={job.id} alt={job.filename || job.id} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/60 text-xs">
              {STATUS_LABEL[job.status] || job.status}
            </div>
          )}
        </div>
        <div className="p-3">
          <div className="font-medium text-sm truncate text-slate-900" title={job.filename}>
            {job.filename || job.id}
          </div>
          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
            <span>{date}</span>
            {job.language && (
              <>
                <span>·</span>
                <span className="uppercase tracking-wide">{job.language}</span>
              </>
            )}
            {!ready && (
              <>
                <span>·</span>
                <span className="text-amber-600">{STATUS_LABEL[job.status]}</span>
              </>
            )}
          </div>
        </div>
      </button>
      <button
        onClick={onDelete}
        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 text-slate-500 hover:bg-rose-500 hover:text-white opacity-0 group-hover:opacity-100 transition shadow-sm"
        title="Delete project"
      >
        ✕
      </button>
    </li>
  )
}

function ThumbImage({ jobId, alt }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="w-full h-full flex items-center justify-center text-white/50 text-xs">
        (no thumbnail)
      </div>
    )
  }
  return (
    <img
      src={jobThumbUrl(jobId)}
      alt={alt}
      className="w-full h-full object-cover"
      onError={() => setFailed(true)}
    />
  )
}

function EmptyState({ onCreate }) {
  return (
    <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center bg-slate-50">
      <p className="text-slate-600 mb-4">No projects yet.</p>
      <button
        onClick={onCreate}
        style={{ background: GRADIENTS.horizontal }}
        className="px-6 py-3 rounded-full text-white shadow-md hover:shadow-lg transition-shadow font-semibold"
      >
        Create your first project
      </button>
    </div>
  )
}
