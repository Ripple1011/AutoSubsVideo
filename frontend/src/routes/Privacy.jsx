import { Link } from 'react-router-dom'
import { BRAND, LOGO } from '../lib/brand'

/**
 * Placeholder privacy policy. THIS IS NOT LAWYER-REVIEWED COPY.
 *
 * Razorpay activation will reject a vendor whose site lacks a privacy page
 * entirely, so this page exists to satisfy that gate AND to set expectations
 * with users. Before processing real money or scaling to public users,
 * a lawyer should review and replace the placeholder sections marked
 * with `[LAWYER REVIEW]`.
 */
export default function Privacy() {
  return (
    <div className="min-h-screen bg-white text-slate-800 font-[Inter]">
      <TopNav />
      <article className="max-w-3xl mx-auto px-6 py-12 prose prose-slate">
        <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="text-sm text-slate-500">Last updated: {BRAND.copyrightYear}-05-29</p>

        <Section title="What we collect">
          <p>
            When you sign in with Google we receive your email address and
            basic profile info (name, profile picture URL) — nothing more.
            We do not request access to your Gmail, Drive, calendar, or
            contacts.
          </p>
          <p>
            When you upload a video, we store the source file, the extracted
            audio, and the generated subtitle text on our servers so you can
            return and re-edit. Source files are retained for {BRAND.copyrightYear === 2026 ? 14 : 14} days
            by default; you can delete a project at any time and its files
            are removed immediately.
          </p>
        </Section>

        <Section title="What we share">
          <p>
            We send the extracted audio to <strong>Google Gemini</strong> to
            generate the subtitle text. Google's processing is governed by
            their AI/ML privacy policy. We do not send your name, email, or
            any other identifying information along with the audio.
          </p>
          <p>
            We do not sell your data, do not run trackers beyond what's
            required for sign-in, and do not share your videos or transcripts
            with any third party except as described above.
          </p>
        </Section>

        <Section title="Payments">
          <p>
            Purchases are processed by <strong>Razorpay</strong>. Card and
            UPI details are entered on Razorpay's checkout — we never see
            or store them. We retain the Razorpay payment ID against your
            account for refund and accounting purposes.
          </p>
        </Section>

        <Section title="Your choices">
          <p>
            You can delete any individual project from the Projects page,
            or your entire account by emailing <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
            On account deletion we remove all uploaded files, transcripts,
            and payment metadata within 30 days.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about this policy: <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
          </p>
          <p className="text-xs text-slate-400 italic">
            [LAWYER REVIEW] This document is a working draft and has not been
            reviewed by counsel. Before processing live payments at scale,
            replace this placeholder with a counsel-reviewed policy covering
            jurisdiction-specific requirements (Information Technology Act
            2000, DPDP Act 2023, GDPR for any EU users).
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
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <img src={LOGO.full} alt={BRAND.name} className="h-9 w-auto" />
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link to="/pricing" className="text-slate-600 hover:text-slate-900">Pricing</Link>
          <Link to="/login" className="text-slate-600 hover:text-slate-900">Sign in</Link>
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
