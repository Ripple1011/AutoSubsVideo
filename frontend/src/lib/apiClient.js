/**
 * Thin fetch wrapper that attaches BYOK headers from localStorage.
 * Backend resolution order is header > server .env (see whisper_client.py).
 */

const STORAGE_KEY = 'autosub.byok'

export function loadByok() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : { provider: '', model: '', apiKey: '' }
  } catch {
    return { provider: '', model: '', apiKey: '' }
  }
}

export function saveByok(byok) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(byok))
}

export function clearByok() {
  localStorage.removeItem(STORAGE_KEY)
}

function byokHeaders() {
  const { provider, model, apiKey } = loadByok()
  const h = {}
  if (apiKey) h['X-User-ASR-Key'] = apiKey
  if (provider) h['X-User-ASR-Provider'] = provider
  if (model) h['X-User-ASR-Model'] = model
  return h
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...byokHeaders(), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
  return data
}

export async function uploadFile(file, language, prompt = '', startOffset = 0) {
  const form = new FormData()
  form.append('file', file)
  form.append('language', language)
  if (prompt) form.append('prompt', prompt)
  if (startOffset > 0) form.append('start_offset', String(startOffset))
  // Don't set Content-Type — the browser sets multipart boundary itself.
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: byokHeaders(),
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
  return data
}
