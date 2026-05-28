/**
 * Single source of truth for the default subtitle style. Shared between
 * routes so a fresh `/projects/new` flow and the legacy single-state App
 * agree on what a "blank" style looks like, and `localStorage.autosub.style`
 * survives schema additions by merging over this object on read.
 */
export const DEFAULT_STYLE = {
  font: 'Montserrat Black',
  textColor: '#ffffff',
  outlineColor: '#000000',
  highlightColor: '#aa3bff',
  highlightTransparent: false,
  speakerColors: {},
  karaokeEnabled: false,
  karaokeColor: '#ffe066',
  scale: 1.0,
  verticalAlignment: 'bottom',
  animation: 'fade',
  animationSpeed: 'normal',
}

export const LS_STYLE = 'autosub.style'

export function loadSavedStyle() {
  try {
    const raw = localStorage.getItem(LS_STYLE)
    if (!raw) return DEFAULT_STYLE
    return { ...DEFAULT_STYLE, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_STYLE
  }
}
