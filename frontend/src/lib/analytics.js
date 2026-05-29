import posthog from 'posthog-js'

/**
 * Thin wrapper around posthog-js so the rest of the app talks to a small
 * stable surface (`track`, `identify`, `reset`) rather than the SDK directly.
 * Two reasons:
 *   1. If we swap providers later (Plausible, Amplitude, etc.) only this file
 *      changes -- call sites don't.
 *   2. In dev we want events to no-op by default. Otherwise every hot reload
 *      pollutes the funnel with "upload_started" events from local testing.
 *      Set VITE_POSTHOG_DEV=1 in .env.local if you genuinely need to test
 *      events locally.
 *
 * The PostHog project key lives in VITE_POSTHOG_KEY (build-time env). Keys
 * are public by design -- they only authorize event ingestion, not reading.
 */

const KEY = import.meta.env.VITE_POSTHOG_KEY
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'

// Production = anything served from a non-localhost host. Vite's import.meta.env.DEV
// is true for `npm run dev` (so local testing stays silent by default).
const ENABLED = Boolean(KEY) && (!import.meta.env.DEV || import.meta.env.VITE_POSTHOG_DEV === '1')

let initialized = false

export function initAnalytics() {
  if (!ENABLED || initialized) return
  posthog.init(KEY, {
    api_host: HOST,
    person_profiles: 'identified_only',   // anonymous browsing doesn't create profiles
    capture_pageview: false,              // we drive pageviews via the router for SPA accuracy
    capture_pageleave: true,
    autocapture: false,                   // we want intentional events only, not every click
  })
  initialized = true
}

/** Fire a custom event. No-op if analytics disabled. */
export function track(name, props) {
  if (!ENABLED || !initialized) return
  posthog.capture(name, props)
}

/** Tie this browser session to a user_id once login succeeds. */
export function identify(userId, traits) {
  if (!ENABLED || !initialized) return
  posthog.identify(userId, traits)
}

/** Clear identity on logout so the next user starts fresh. */
export function reset() {
  if (!ENABLED || !initialized) return
  posthog.reset()
}

/** Manual pageview -- called from a useEffect on route changes. */
export function pageview(path) {
  if (!ENABLED || !initialized) return
  posthog.capture('$pageview', { $current_url: window.location.origin + path })
}
