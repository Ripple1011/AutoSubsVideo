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

// 401 handler. With OAuth + cookie sessions (Slice 2) the right behavior is
// to redirect to /login — the session has expired or doesn't exist. The
// shared-password legacy prompt is kept as a fallback for endpoints that
// still respond with 401 + a SHARED_PASSWORD detail (i.e. when the gate
// header is mismatched, not when the session is missing).
function handleUnauthorized(detail) {
  // Only treat as "needs login" when the server hints at session/auth.
  // Heuristic: shared-password failures mention 'password' in the detail.
  const isPwdGate = typeof detail === 'string' && detail.toLowerCase().includes('password')
  if (isPwdGate) {
    clearSharedPassword()
    const next = window.prompt(
      'AutoSub password required (or current one is wrong).\n\n' +
      'Ask the operator for the SHARED_PASSWORD configured on the server.'
    )
    if (!next) return false
    setSharedPassword(next)
    return true
  }
  // Real session loss → bounce to /login. Preserve the current path so the
  // login page can send the user back here after auth.
  const here = window.location.pathname + window.location.search
  if (window.location.pathname !== '/login') {
    window.location.href = `/login?next=${encodeURIComponent(here)}`
  }
  return false
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = {
    method,
    credentials: 'include',   // send session cookie
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }
  let res = await fetch(`/api${path}`, opts)
  if (res.status === 401) {
    const data = await res.clone().json().catch(() => ({}))
    if (handleUnauthorized(data.detail)) {
      // Retry once after re-prompting for the shared password.
      opts.headers = { 'Content-Type': 'application/json', ...authHeaders(), ...headers }
      res = await fetch(`/api${path}`, opts)
    }
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
    credentials: 'include',
    headers: authHeaders(),
    body: form,
  })
  let res = await send()
  if (res.status === 401) {
    const data = await res.clone().json().catch(() => ({}))
    if (handleUnauthorized(data.detail)) {
      res = await send()
    }
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
  return data
}

// --- Thumbnail URL ----------------------------------------------------------
// Used by the Projects-list cards. The shared-password gate allows this
// path without an `X-AutoSub-Password` header (see _PUBLIC_GET_PATHS in
// main.py), so a raw <img src=...> works even when the user is "logged in"
// only via cookie/header.
export const jobThumbUrl = (id) => `/api/jobs/${id}/thumb`
