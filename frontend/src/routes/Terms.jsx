import { Link } from 'react-router-dom'
import { BRAND, LOGO } from '../lib/brand'

/**
 * Placeholder Terms of Service. THIS IS NOT LAWYER-REVIEWED COPY.
 *
 * Same disclaimer as Privacy.jsx — exists primarily so the footer has a
 * link to point at and Razorpay activation doesn't flag the site. Replace
 * sections marked `[LAWYER REVIEW]` with counsel-reviewed copy before
 * processing live payments at scale.
 */
export default function Terms() {
  return (
    <div className="min-h-screen bg-white text-slate-800 font-[Inter]">
      <TopNav />
      <article className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-slate-900">Terms of Service</h1>
        <p className="text-sm text-slate-500">Last updated: {BRAND.copyrightYear}-05-29</p>

        <Section title="Using Vaacha">
          <p>
            By signing in to {BRAND.name} you agree to use the service
            responsibly: don't upload content you don't have the right to
            transcribe, don't attempt to abuse the credit system, and don't
            try to interfere with other users' accounts.
          </p>
        </Section>

        <Section title="Credits, packs, and subscriptions">
          <p>
            One credit equals one subtitle generation for a video up to 60
            seconds. Credits from one-time packs do not expire. Subscription
            credits refresh on the renewal date; unused subscription credits
            may roll over up to the cap stated on the pricing page, after
            which they expire.
          </p>
          <p>
            We refund a credit if a transcription fails due to a system
            error. Credits consumed by valid completed transcriptions are
            not refundable.
          </p>
        </Section>

        <Section title="Payments and refunds">
          <p>
            Payments are processed by Razorpay. One-time pack purchases are
            non-refundable once credits are credited to your account. For
            subscriptions, you may cancel at any time; cancellation takes
            effect at the end of the current billing period and we do not
            pro-rate partial periods.
          </p>
        </Section>

        <Section title="Content you upload">
          <p>
            You retain all rights to videos you upload. Vaacha is granted a
            limited license to process your videos (extract audio, generate
            subtitles, render burned exports) solely to provide the service.
            We do not use your videos to train models or for any other
            purpose.
          </p>
        </Section>

        <Section title="Account termination">
          <p>
            We may suspend or terminate accounts that abuse the service —
            e.g. attempts to extract credits without payment, mass-uploading
            content that violates third-party rights, or scripted use that
            exceeds reasonable individual creator volumes. We'll email a
            warning before termination unless the abuse is severe.
          </p>
        </Section>

        <Section title="Service availability">
          <p>
            We aim for high availability but do not guarantee 100% uptime.
            Vaacha depends on third-party services (Google for sign-in and
            Gemini transcription, Razorpay for payments) whose outages are
            outside our control.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about these terms: <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
          </p>
          <p className="text-xs text-slate-400 italic">
            [LAWYER REVIEW] This document is a working draft. Before
            processing live payments at scale, replace with counsel-reviewed
            terms covering jurisdiction (India / DPDP Act 2023), limitation
            of liability, indemnity, dispute resolution, and arbitration
            clauses appropriate for a SaaS sold to Indian consumers.
          </p>
        </Section>
      </article>
      <FooterMini />
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-3 text-sm text-slate-600 leading-relaxed">
        {children}
      </div>
    </section>
  )
}

function TopNav() {
  return (
    <header className="border-b border-slate-200/70 bg-white sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <img src={LOGO.full} alt={BRAND.name} className="h-14 w-auto" />
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link to="/pricing" className="text-slate-600 hover:text-slate-900 font-medium">Pricing</Link>
          <Link to="/login" className="text-slate-600 hover:text-slate-900 font-medium">Sign in</Link>
        </nav>
      </div>
    </header>
  )
}

function FooterMini() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50 mt-12">
      <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-3">
        <div>© {BRAND.copyrightYear} {BRAND.name} · by {BRAND.parent}</div>
        <div className="flex gap-4">
          <Link to="/privacy" className="hover:text-slate-900">Privacy</Link>
          <Link to="/terms" className="hover:text-slate-900">Terms</Link>
          <a href={`mailto:${BRAND.supportEmail}`} className="hover:text-slate-900">Support</a>
        </div>
      </div>
    </footer>
  )
}
