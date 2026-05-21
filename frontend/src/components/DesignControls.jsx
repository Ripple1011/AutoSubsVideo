import ColorPicker from './ColorPicker'

// Each label maps to a multi-script stack. The browser resolves font-family
// per codepoint, so Latin chars use the first font, Devanagari/Gujarati chars
// drop to a script-matched display font (not generic Noto fallback).
//
// Pairings chosen for visual weight parity (heavy Latin ↔ heavy Indic):
//   Anton / Montserrat / Poppins  → Baloo 2 (Devanagari) + Mukta Vaani (Gujarati)
//   Teko                          → Teko itself covers Devanagari natively
//   Rozha One                     → Rozha One covers Devanagari natively (serif display)
// Noto Sans is the last-resort safety net for any codepoint nothing else covers.
const SAFETY = `"Noto Sans Devanagari", "Noto Sans Gujarati", sans-serif`
const HEAVY_INDIC = `"Baloo 2", "Mukta Vaani", "Mukta", "Hind", ${SAFETY}`

// Each entry: { stack, weight } — weight MUST match a weight we requested in
// index.html, otherwise the browser silently substitutes a generic font for
// codepoints (especially Devanagari) and the chosen face never renders.
export const FONT_STACKS = {
  'Anton':            { stack: `"Anton", Impact, ${HEAVY_INDIC}`,         weight: 400 },
  'Montserrat Black': { stack: `"Montserrat", ${HEAVY_INDIC}`,            weight: 900 },
  'Poppins Bold':     { stack: `"Poppins", ${HEAVY_INDIC}`,               weight: 800 },
  'Teko (Hindi)':     { stack: `"Teko", "Anton", ${SAFETY}`,              weight: 700 },
  'Baloo 2 Medium':   { stack: `"Baloo 2", "Mukta Vaani", ${SAFETY}`,     weight: 500 },
  'Baloo (Hindi)':    { stack: `"Baloo 2", "Mukta Vaani", ${SAFETY}`,     weight: 800 },
  'Mukta (Hindi)':    { stack: `"Mukta", "Mukta Vaani", ${SAFETY}`,       weight: 800 },
  'Rozha (Serif)':    { stack: `"Rozha One", "Rasa", ${SAFETY}`,          weight: 400 },
  'Rasa (Serif)':     { stack: `"Rasa", "Rozha One", ${SAFETY}`,          weight: 700 },
}
const FONTS = Object.keys(FONT_STACKS)
const ALIGNMENTS = ['top', 'center', 'bottom']
const ANIMATIONS = [
  { value: 'none',  label: 'None' },
  { value: 'fade',  label: 'Fade' },
  { value: 'slide', label: 'Slide' },
  { value: 'pop',   label: 'Pop' },
]
const SPEEDS = ['fast', 'normal', 'slow']

/**
 * Design sidebar — fonts, hex colors, scale slider, vertical alignment.
 * Emits the full styleSchema upward; never round-trips to server during editing.
 */
export default function DesignControls({ value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v })

  return (
    <div className="p-4 space-y-4 text-sm">
      <label className="flex items-center justify-between gap-3">
        <span className="text-white/70">Font</span>
        <select
          value={value.font}
          onChange={(e) => set('font', e.target.value)}
          className="bg-[#1a1a22] text-white rounded px-2 py-1 border border-white/10"
        >
          {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>

      <ColorPicker label="Text"      value={value.textColor}      onChange={(v) => set('textColor', v)} />
      <ColorPicker label="Outline"   value={value.outlineColor}   onChange={(v) => set('outlineColor', v)} />
      <ColorPicker label="Highlight" value={value.highlightColor} onChange={(v) => set('highlightColor', v)} />

      <label className="flex items-center justify-between gap-3">
        <span className="text-white/70">Scale</span>
        <input
          type="range" min="0.5" max="2.5" step="0.05"
          value={value.scale}
          onChange={(e) => set('scale', parseFloat(e.target.value))}
          className="flex-1"
        />
        <span className="w-10 text-right font-mono text-xs">{value.scale.toFixed(2)}</span>
      </label>

      <div className="flex items-center justify-between gap-3">
        <span className="text-white/70">Align</span>
        <div className="flex gap-1">
          {ALIGNMENTS.map((a) => (
            <button
              key={a}
              onClick={() => set('verticalAlignment', a)}
              className={`px-3 py-1 rounded text-xs capitalize ${
                value.verticalAlignment === a ? 'bg-purple-500' : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-white/70">Animation</span>
        <div className="flex gap-1">
          {ANIMATIONS.map((a) => (
            <button
              key={a.value}
              onClick={() => set('animation', a.value)}
              className={`px-3 py-1 rounded text-xs ${
                value.animation === a.value ? 'bg-purple-500' : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-white/70">Anim Speed</span>
        <div className="flex gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              disabled={!value.animation || value.animation === 'none'}
              onClick={() => set('animationSpeed', s)}
              className={`px-3 py-1 rounded text-xs capitalize disabled:opacity-30 ${
                value.animationSpeed === s ? 'bg-purple-500' : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
