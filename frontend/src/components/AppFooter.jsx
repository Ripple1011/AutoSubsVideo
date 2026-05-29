import { Link } from 'react-router-dom'
import { BRAND } from '../lib/brand'

/**
 * Slim consistent footer for authed app pages.
 *
 * Public marketing pages (Landing, public Pricing) use a richer footer
 * with product/company link columns. The authed footer is intentionally
 * minimal — Privacy / Terms / Support links + copyright — so it doesn't
 * compete for attention with the editor or projects content.
 */
export default function AppFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50 flex-shrink-0">
      <div className="max-w-6xl mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <div>© {BRAND.copyrightYear} {BRAND.name} · by {BRAND.parent}</div>
        <div className="flex items-center gap-4">
          <Link to="/privacy" className="hover:text-slate-900">Privacy</Link>
          <Link to="/terms" className="hover:text-slate-900">Terms</Link>
          <a href={`mailto:${BRAND.supportEmail}`} className="hover:text-slate-900">Support</a>
        </div>
      </div>
    </footer>
  )
}
