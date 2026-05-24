/**
 * Thin fetch wrapper that attaches BYOK headers + the shared-password
 * gate header from localStorage. Backend resolution for BYOK: header >
 * server .env (see whisper_client.py). Backend gate: SHARED_PASSWORD env
 * on the VPS, leave unset for localhost dev.
 */

const STORAGE_KEY = 'autosub.byok'
const PWD_STORAGE_KEY = 'autosub.password'

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

export function getSharedPassword() {
  try { return localStorage.getItem(PWD_STORAGE_KEY) || '' } catch { return '' }
}

export function setSharedPassword(pwd) {
  try { localStorage.setItem(PWD_STORAGE_KEY, pwd) } catch { /* quota */ }
}

export function clearSharedPassword() {
  try { localStorage.removeItem(PWD_STORAGE_KEY) } catch { /* quota */ }
}

function authHeaders() {
  const { provider, model, apiKey } = loadByok()
  const h = {}
  if (apiKey) h['X-User-ASR-Key'] = apiKey
  if (provider) h['X-User-ASR-Provider'] = provider
  if (model) h['X-User-ASR-Model'] = model
  // Shared-password gate is server-configured; we always send if present.
  // Backend ignores it when SHARED_PASSWORD is unset, so localhost dev
  // works whether or not the user has a stale password in localStorage.
  const pwd = getSharedPassword()
  if (pwd) h['X-AutoSub-Password'] = pwd
  return h
}

// Reusable 401 handler — drops the stored password, prompts for a new one,
// stores it, and returns true if the caller should retry the request.
// Returns false if the user cancelled the prompt.
function handleUnauthorized() {
  clearSharedPassword()
  const next = window.prompt(
    'AutoSub password required (or current one is wrong).\n\n' +
    'Ask the operator for the SHARED_PASSWORD configured on the server.'
  )
  if (!next) return false
  setSharedPassword(next)
  return true
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }
  let res = await fetch(`/api${path}`, opts)
  if (res.status === 401 && handleUnauthorized()) {
    // Retry once with the new password.
    opts.headers = { 'Content-Type': 'application/json', ...authHeaders(), ...headers }
    res = await fetch(`/api${path}`, opts)
  }
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
  const send = () => fetch('/api/upload', {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  let res = await send()
  if (res.status === 401 && handleUnauthorized()) {
    res = await send()
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
  return data
}
