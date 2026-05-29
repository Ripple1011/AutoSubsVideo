/**
 * Single source of truth for Vaacha brand tokens.
 *
 * Tailwind classes are still hand-applied at the component level, but any
 * literal hex / copy text / asset path that's brand-defining lives here so
 * a rebrand is a one-file edit. Components import individual exports rather
 * than reading the whole object, so unused tokens get tree-shaken.
 */

export const BRAND = {
  name: 'Vaacha',
  parent: 'Kairos Lab',
  tagline: 'AI subtitles, made for Indian creators.',
  domain: 'vaacha.app',
  url: 'https://vaacha.app',
  supportEmail: 'support@vaacha.app',
  copyrightYear: 2026,
}

// Color tokens — sourced from the wordmark gradient (V), the wordmark navy,
// and the trilingual icon row. Use these via inline styles or arbitrary
// Tailwind classes (`bg-[#2C6BFF]`) when a semantic Tailwind class isn't
// granular enough.
export const COLORS = {
  // Brand gradient (the `V` of the wordmark): blue → purple.
  gradientFrom: '#2C6BFF',
  gradientTo: '#7C3AED',
  // Wordmark navy. Use as a deep background or heading color on light themes.
  dark: '#0B1A33',
  // Tagline gray. Body / secondary text on light backgrounds.
  mid: '#94A3B8',
  // Three trilingual icon row accents — kept as semantic accents so we can
  // tint language-specific UI without picking new colors.
  accentSpeech: '#F97316', // orange waveform — songs / audio cues
  accentHindi: '#7C3AED',  // purple अ — Hindi UI accents
  accentGujarati: '#14B8A6', // teal અ — Gujarati UI accents
}

// CSS gradient strings, ready to drop into a style prop. Two directions
// because some surfaces (buttons) want left→right, others (text) want a
// subtle diagonal sweep.
export const GRADIENTS = {
  horizontal: `linear-gradient(90deg, ${COLORS.gradientFrom} 0%, ${COLORS.gradientTo} 100%)`,
  diagonal: `linear-gradient(135deg, ${COLORS.gradientFrom} 0%, ${COLORS.gradientTo} 100%)`,
}

// Logo asset paths — referenced from <img src>. Lives in /public so Vite
// serves them at the root with no bundling overhead.
export const LOGO = {
  full: '/logo.png',         // full lockup; landing page hero, marketing
  icon: '/logo.png',         // TODO: replace with wordmark-only when designer
                             // delivers a tighter top-bar variant
}

// CTA copy used in multiple places — change here and every CTA updates.
export const CTA = {
  signinPrimary: 'Start free with Google',
  signinSecondary: 'Continue with Google',
}
