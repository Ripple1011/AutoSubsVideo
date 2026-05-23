// Curated starter style presets shown at the top of DesignControls.
//
// Each preset is a partial style snapshot that gets merged INTO the live
// styleSchema when clicked. Non-preset fields (most importantly
// speakerColors, which are content-specific) are preserved across switches.
//
// Adding a preset is just appending an entry here — no other code change
// needed. Every field listed in `style` must exist in App.jsx's
// DEFAULT_STYLE so the merge produces a coherent object.

export const STYLE_PRESETS = [
  {
    id: 'bold',
    name: 'Bold',
    style: {
      font: 'Montserrat Black',
      textColor: '#ffffff',
      outlineColor: '#000000',
      highlightColor: '#aa3bff',
      highlightTransparent: true,
      scale: 1.0,
      verticalAlignment: 'bottom',
      animation: 'fade',
      animationSpeed: 'normal',
    },
  },
  {
    id: 'punch',
    name: 'Punch',
    style: {
      font: 'Anton',
      textColor: '#ffeb3b',
      outlineColor: '#000000',
      highlightColor: '#aa3bff',
      highlightTransparent: true,
      scale: 1.2,
      verticalAlignment: 'bottom',
      animation: 'pop',
      animationSpeed: 'fast',
    },
  },
  {
    id: 'highlight',
    name: 'Highlight',
    style: {
      font: 'Poppins Bold',
      textColor: '#ffffff',
      outlineColor: '#000000',
      highlightColor: '#aa3bff',
      highlightTransparent: false,
      scale: 1.0,
      verticalAlignment: 'bottom',
      animation: 'fade',
      animationSpeed: 'normal',
    },
  },
  {
    id: 'bhajan',
    name: 'Bhajan',
    style: {
      font: 'Rozha (Serif)',
      textColor: '#f5c542',
      outlineColor: '#000000',
      highlightColor: '#aa3bff',
      highlightTransparent: true,
      scale: 1.1,
      verticalAlignment: 'bottom',
      animation: 'fade',
      animationSpeed: 'slow',
    },
  },
  {
    id: 'caption',
    name: 'Caption',
    style: {
      font: 'Montserrat Black',
      textColor: '#ffffff',
      outlineColor: '#000000',
      highlightColor: '#000000',
      highlightTransparent: false,
      scale: 0.9,
      verticalAlignment: 'bottom',
      animation: 'none',
      animationSpeed: 'normal',
    },
  },
  {
    id: 'karaoke',
    name: 'Karaoke',
    style: {
      font: 'Anton',
      textColor: '#ffffff',
      outlineColor: '#000000',
      highlightColor: '#aa3bff',
      highlightTransparent: true,
      scale: 1.3,
      verticalAlignment: 'center',
      animation: 'slide',
      animationSpeed: 'normal',
    },
  },
  {
    id: 'subtle',
    name: 'Subtle',
    style: {
      font: 'Montserrat Black',
      textColor: '#ffffff',
      outlineColor: '#000000',
      highlightColor: '#aa3bff',
      highlightTransparent: true,
      scale: 0.85,
      verticalAlignment: 'bottom',
      animation: 'fade',
      animationSpeed: 'fast',
    },
  },
  {
    id: 'doc',
    name: 'Doc',
    style: {
      font: 'Mukta (Hindi)',
      textColor: '#ffffff',
      outlineColor: '#000000',
      highlightColor: '#1a1a22',
      highlightTransparent: false,
      scale: 0.95,
      verticalAlignment: 'bottom',
      animation: 'fade',
      animationSpeed: 'normal',
    },
  },
  {
    id: 'hormozi',
    name: 'Hormozi',
    style: {
      font: 'Anton',
      textColor: '#000000',
      outlineColor: '#000000',
      highlightColor: '#ffe066',
      highlightTransparent: false,
      scale: 1.0,
      verticalAlignment: 'bottom',
      animation: 'fade',
      animationSpeed: 'normal',
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    style: {
      font: 'Poppins Bold',
      textColor: '#00f0ff',
      outlineColor: '#0a0a2a',
      highlightColor: '#aa3bff',
      highlightTransparent: true,
      scale: 1.0,
      verticalAlignment: 'bottom',
      animation: 'fade',
      animationSpeed: 'normal',
    },
  },
  {
    id: 'news',
    name: 'News',
    style: {
      font: 'Montserrat Black',
      textColor: '#ffffff',
      outlineColor: '#001a3d',
      highlightColor: '#0a3a7c',
      highlightTransparent: false,
      scale: 0.95,
      verticalAlignment: 'bottom',
      animation: 'none',
      animationSpeed: 'normal',
    },
  },
  {
    id: 'story',
    name: 'Story',
    style: {
      font: 'Montserrat Black',
      textColor: '#ffffff',
      outlineColor: '#000000',
      highlightColor: '#aa3bff',
      highlightTransparent: true,
      scale: 1.1,
      verticalAlignment: 'center',
      animation: 'fade',
      animationSpeed: 'normal',
    },
  },
  {
    id: 'cinema',
    name: 'Cinema',
    style: {
      font: 'Rasa (Serif)',
      textColor: '#ffffff',
      outlineColor: '#000000',
      highlightColor: '#aa3bff',
      highlightTransparent: true,
      scale: 0.95,
      verticalAlignment: 'bottom',
      animation: 'fade',
      animationSpeed: 'slow',
    },
  },
  {
    id: 'big-red',
    name: 'Big Red',
    style: {
      font: 'Anton',
      textColor: '#ff2d2d',
      outlineColor: '#000000',
      highlightColor: '#aa3bff',
      highlightTransparent: true,
      scale: 1.3,
      verticalAlignment: 'bottom',
      animation: 'pop',
      animationSpeed: 'fast',
    },
  },
]

// Returns the preset whose every `style` field exactly matches the current
// style schema, or undefined if the user has customized away from any preset.
// Used to highlight the active preset button.
export function findActivePreset(currentStyle) {
  if (!currentStyle) return undefined
  return STYLE_PRESETS.find((p) =>
    Object.entries(p.style).every(([k, v]) => currentStyle[k] === v)
  )
}

// Merge a preset's style fields onto the current schema. Per-speaker
// overrides are cleared on apply — they're inherently a customisation on
// top of a base palette, and if you've kept them across a preset switch
// they end up shadowing the new preset's textColor (so "Bhajan" wouldn't
// look gold for Speaker 1 because a previous red override would win).
// Treating apply-preset as a fresh styling reset is the predictable
// behaviour. Customise per-speaker AFTER picking the preset.
export function applyPreset(preset, currentStyle) {
  return { ...currentStyle, ...preset.style, speakerColors: {} }
}
