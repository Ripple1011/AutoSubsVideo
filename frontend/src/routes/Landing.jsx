import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { api } from '../lib/apiClient'
import { BRAND, COLORS, GRADIENTS, LOGO, CTA } from '../lib/brand'

/**
 * Vaacha public landing page at `/`.
 *
 * Logged-in users get redirected to /projects on mount — the landing is for
 * acquisition, not navigation. Logged-out users see the full marketing
 * surface: hero, animated subtitle demo, how-it-works, pricing teaser,
 * footer. Brand tokens (gradient, colors, copy) come from lib/brand.js so
 * a tagline edit doesn't require touching this file.
 *
 * Visual structure is intentionally one long scroll rather than tabs/anchors
 * — mobile-first reading pattern, and short-form creators don't want to
 * hunt for information.
 */
export default function Landing() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()

  // Auto-redirect logged-in visitors. Lets bookmarks and direct-typing of
  // vaacha.app work as "open my dashboard" for returning users without
  // forcing them through a landing they don't need.
  useEffect(() => {
    if (!loading && user) navigate('/projects', { replace: true })
  }, [user, loading, navigate])

  // While the auth probe is in flight we render the landing anyway — flash
  // of marketing is harmless. Only hide it once we've confirmed logged in.
  if (loading) return <div className="min-h-screen bg-white" />
  if (user) return null

  return (
    <div className="min-h-screen bg-white text-slate-800 font-[Inter]">
      <TopNav />
      <Hero />
      <HowItWorks />
      <PricingTeaser />
      <Footer />
    </div>
  )
}

// ----- Top nav -------------------------------------------------------------

function TopNav() {
  return (
    <header className="border-b border-slate-200/70 bg-white/90 backdrop-blur sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          {/* Logo at 56px height -- substantial enough to read as a brand
              mark, leaves room for the nav buttons to breathe. Sticky bar
              uses h-20 (80px) container so the logo doesn't crowd the
              border. */}
          <img src={LOGO.full} alt={BRAND.name} className="h-14 w-auto" />
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link to="/pricing" className="text-slate-600 hover:text-slate-900 font-medium">Pricing</Link>
          <Link
            to="/login"
            className="px-5 py-2.5 rounded-full text-white font-semibold text-sm shadow-md hover:shadow-lg transition-shadow"
            style={{ background: GRADIENTS.horizontal }}
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  )
}

// ----- Hero ----------------------------------------------------------------

function Hero() {
  return (
    <section className="max-w-6xl mx-auto px-6 pt-16 pb-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      <div>
        <div
          className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-white mb-6"
          style={{ background: GRADIENTS.horizontal }}
        >
          ✨ Now in English, Hindi & Gujarati
        </div>
        <h1
          className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight"
          style={{ color: COLORS.dark }}
        >
          {BRAND.tagline}
        </h1>
        <p className="mt-6 text-lg text-slate-600 leading-relaxed max-w-xl">
          Drop a reel, get stylized animated subtitles synced to the speech —
          ready to post. No timeline editing. No premium subscription. Just
          the look you want, in the language your audience speaks.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <Link
            to="/login"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full text-white font-semibold shadow-lg hover:shadow-xl transition-shadow"
            style={{ background: GRADIENTS.horizontal }}
          >
            {CTA.signinPrimary}
            <span aria-hidden>→</span>
          </Link>
          <Link
            to="/pricing"
            className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-emerald-100 text-emerald-800 font-semibold hover:bg-emerald-200 transition-colors"
          >
            See pricing
          </Link>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          🪙 3 free videos on signup · no credit card required
        </p>
      </div>

      <HeroDemo />
    </section>
  )
}

/**
 * 9:16 phone-frame demo. Real burned video — `public/hero-demo.mp4` is
 * a Vaacha export looped in the hero slot. Keeps the same 280x500 frame
 * as the original CSS mockup so the surrounding layout is unchanged.
 *
 * Autoplay+muted+playsInline are the trio required for autoplay on iOS
 * Safari and to satisfy Chrome's muted-autoplay-only policy. A tap on
 * the speaker icon unmutes — that interaction satisfies the browser
 * autoplay-with-audio rule from then on.
 */
function HeroDemo() {
  const videoRef = useRef(null)
  const [muted, setMuted] = useState(true)
  const [playing, setPlaying] = useState(true)

  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    const next = !v.muted
    v.muted = next
    setMuted(next)
    if (!next) v.play().catch(() => {})
  }

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      v.play().catch(() => {})
    } else {
      v.pause()
    }
  }

  return (
    <div className="flex items-center justify-center">
      <div
        className="relative rounded-[2.2rem] overflow-hidden shadow-2xl bg-black"
        style={{ width: 280, height: 500 }}
      >
        <video
          ref={videoRef}
          src="/hero-demo.mp4"
          className="w-full h-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        {/* Phone notch — sits above the video for the device-frame look. */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-20 h-5 rounded-full bg-black/80 z-10" />
        {/* Play / pause pill — bottom-left. */}
        <button
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="absolute bottom-4 left-4 z-10 w-9 h-9 rounded-full bg-black/55 hover:bg-black/75 backdrop-blur text-white text-base flex items-center justify-center shadow-lg transition"
        >
          {playing ? '⏸' : '▶'}
        </button>
        {/* Mute / unmute pill — bottom-right. */}
        <button
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="absolute bottom-4 right-4 z-10 w-9 h-9 rounded-full bg-black/55 hover:bg-black/75 backdrop-blur text-white text-base flex items-center justify-center shadow-lg transition"
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </div>
    </div>
  )
}

// ----- How it works -------------------------------------------------------

function HowItWorks() {
  const STEPS = [
    {
      n: '1',
      title: 'Drop your video',
      body: 'Upload a .mp4 or .mov of up to 60 seconds — the typical reel or short.',
      accent: COLORS.gradientFrom,
    },
    {
      n: '2',
      title: 'Pick a language',
      body: 'English, Hindi, Gujarati, or auto-detect. Vaacha uses Gemini 2.5 Pro for word-accurate timing.',
      accent: COLORS.accentHindi,
    },
    {
      n: '3',
      title: 'Style and download',
      body: 'Choose a font, color, animation, and burn subtitles into a new .mp4. Ready to post.',
      accent: COLORS.accentGujarati,
    },
  ]

  return (
    <section className="bg-slate-50 py-20">
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="text-3xl font-bold text-center mb-3" style={{ color: COLORS.dark }}>
          From upload to ready-to-post in three steps
        </h2>
        <p className="text-center text-slate-600 mb-12 max-w-2xl mx-auto">
          No timeline. No frame-by-frame editing. Vaacha handles the syncing,
          the language detection, and the styling — you just pick the look.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-shadow"
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm mb-4"
                style={{ background: s.accent }}
              >
                {s.n}
              </div>
              <div className="text-lg font-semibold mb-2" style={{ color: COLORS.dark }}>
                {s.title}
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ----- Pricing teaser ------------------------------------------------------

const FALLBACK_PLANS = [
  { slug: 'pack_10', display_name: 'Starter Pack', credits_granted: 10, price_inr: 49, cadence: 'one_time' },
  { slug: 'pack_50', display_name: 'Creator Pack', credits_granted: 50, price_inr: 199, cadence: 'one_time' },
  { slug: 'monthly', display_name: 'Pro Monthly', credits_granted: 150, price_inr: 399, cadence: 'monthly' },
  { slug: 'annual',  display_name: 'Pro Annual',  credits_granted: 1500, price_inr: 2999, cadence: 'annual' },
]

function PricingTeaser() {
  const [plans, setPlans] = useState(FALLBACK_PLANS)
  useEffect(() => {
    api('/plans').then((d) => {
      if (Array.isArray(d.plans) && d.plans.length) setPlans(d.plans)
    }).catch(() => { /* keep fallback */ })
  }, [])

  return (
    <section className="py-20">
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="text-3xl font-bold text-center mb-3" style={{ color: COLORS.dark }}>
          Simple pricing
        </h2>
        <p className="text-center text-slate-600 mb-12 max-w-2xl mx-auto">
          Pay only for what you use. One video = one credit. Cancel any
          subscription anytime.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((p) => (
            <div
              key={p.slug}
              className="rounded-2xl p-5 border border-slate-200 hover:border-slate-300 transition-colors flex flex-col"
            >
              <div className="text-xs uppercase tracking-wide font-semibold mb-1" style={{ color: COLORS.gradientTo }}>
                {p.cadence === 'one_time' ? 'One-time' : p.cadence === 'monthly' ? 'Per month' : 'Per year'}
              </div>
              <div className="text-base font-semibold mb-3" style={{ color: COLORS.dark }}>
                {p.display_name}
              </div>
              <div className="text-3xl font-bold mb-1" style={{ color: COLORS.dark }}>
                ₹{Number(p.price_inr).toLocaleString('en-IN')}
              </div>
              <div className="text-sm text-slate-500 mb-4">
                🪙 {Number(p.credits_granted).toLocaleString('en-IN')} videos
              </div>
              <Link
                to="/pricing"
                className="mt-auto text-center text-xs font-semibold text-slate-600 hover:text-slate-900 underline underline-offset-2"
              >
                See details →
              </Link>
            </div>
          ))}
        </div>
        <div className="text-center mt-10">
          <Link
            to="/login"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full text-white font-semibold shadow-lg hover:shadow-xl transition-shadow"
            style={{ background: GRADIENTS.horizontal }}
          >
            {CTA.signinPrimary}
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </section>
  )
}

// ----- Footer --------------------------------------------------------------

function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-2 sm:grid-cols-4 gap-8 text-sm">
        <div className="col-span-2 sm:col-span-2">
          <img src={LOGO.full} alt={BRAND.name} className="h-12 w-auto mb-3" />
          <p className="text-slate-500 max-w-sm">{BRAND.tagline}</p>
        </div>
        <div>
          <div className="font-semibold text-slate-700 mb-3">Product</div>
          <ul className="space-y-2 text-slate-500">
            <li><Link to="/pricing" className="hover:text-slate-900">Pricing</Link></li>
            <li><Link to="/login" className="hover:text-slate-900">Sign in</Link></li>
          </ul>
        </div>
        <div>
          <div className="font-semibold text-slate-700 mb-3">Company</div>
          <ul className="space-y-2 text-slate-500">
            <li><Link to="/privacy" className="hover:text-slate-900">Privacy</Link></li>
            <li><Link to="/terms" className="hover:text-slate-900">Terms</Link></li>
            <li>
              <a href={`mailto:${BRAND.supportEmail}`} className="hover:text-slate-900">
                Support
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-3">
          <div>© {BRAND.copyrightYear} {BRAND.name} · by {BRAND.parent}</div>
          <div>Made for creators in Bharat 🇮🇳</div>
        </div>
      </div>
    </footer>
  )
}
