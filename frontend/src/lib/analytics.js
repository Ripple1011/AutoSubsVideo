import posthog from 'posthog-js'

// ----- Google Analytics 4 (gtag.js) ---------------------------------------
// Loaded alongside PostHog because they answer different questions: GA4 is
// for marketing / ad attribution ("which channel sent this user"), PostHog
// is for product behavior ("did this user reach the export step"). GA4 is
// optional -- the bootstrap below no-ops if VITE_GA4_ID isn't set.

const GA4_ID = import.meta.env.VITE_GA4_ID

function loadGA4() {
  if (!GA4_ID) return
  // Inject the gtag loader exactly per Google's recommended snippet.
  // Async, so it never blocks page paint.
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`
  document.head.appendChild(s)
  window.dataLayer = window.dataLayer || []
  function gtag() { window.dataLayer.push(arguments) }
  window.gtag = gtag
  gtag('js', new Date())
  // send_page_view=false because we fire pageviews manually on route change
  // (same reason we do this for PostHog -- SPA route changes don't trigger
  // the default auto-pageview).
  gtag('config', GA4_ID, { send_page_view: false })
}

function ga4Pageview(path) {
  if (!GA4_ID || !window.gtag) return
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.origin + path,
  })
}

function ga4Event(name, props) {
  if (!GA4_ID || !window.gtag) return
  window.gtag('event', name, props || {})
}

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
  // GA4 doesn't care about ENABLED (it's a separate gate via VITE_GA4_ID)
  // and we want GA4 to run even in dev if the env var is set, because GA4
  // already debounces well and is mainly used post-launch for ad attribution.
  loadGA4()

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

/** Fire a custom event to both PostHog and GA4. Each no-ops independently. */
export function track(name, props) {
  if (ENABLED && initialized) posthog.capture(name, props)
  ga4Event(name, props)
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

/** Manual pageview -- fires on route changes, sent to both backends. */
export function pageview(path) {
  if (ENABLED && initialized) {
    posthog.capture('$pageview', { $current_url: window.location.origin + path })
  }
  ga4Pageview(path)
}
