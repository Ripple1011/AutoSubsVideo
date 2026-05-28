import { useNavigate } from 'react-router-dom'
import DropZone from '../components/DropZone'

/**
 * The upload flow as a route. Reuses the existing <DropZone> component for
 * the entire UX (file picker, language, prompt, trim slider, progress) and
 * just navigates to /projects/:id on success.
 */
export default function NewProject() {
  const navigate = useNavigate()
  const handleReady = ({ jobId }) => {
    if (jobId) navigate(`/projects/${jobId}`, { replace: true })
    else navigate('/projects', { replace: true })
  }
  return (
    <div className="max-w-2xl mx-auto pt-2">
      <DropZone onReady={handleReady} />
    </div>
  )
}
