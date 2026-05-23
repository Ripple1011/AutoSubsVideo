import { useMemo } from 'react'
import ColorPicker from './ColorPicker'
import { SPEAKER_PALETTE, colorForSpeaker, speakerOrderFromSegments } from '../lib/speakerColors'
import { STYLE_PRESETS, findActivePreset, applyPreset } from '../lib/stylePresets'

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
 *
 * When `segments` carries 2+ distinct speakers, a Speaker Colors section
 * appears so the user can override the auto-assigned palette per speaker
 * label. Overrides land in `value.speakerColors[<label>]` and flow through
 * colorForSpeaker() everywhere (canvas overlay, sidebar stripe, ASS burn).
 */
export default function DesignControls({ value, onChange, segments = [] }) {
  const set = (k, v) => onChange({ ...value, [k]: v })
  const setSpeakerColor = (label, color) => {
    onChange({
      ...value,
      speakerColors: { ...(value.speakerColors || {}), [label]: color },
    })
  }
  const clearSpeakerColor = (label) => {
    const next = { ...(value.speakerColors || {}) }
    delete next[label]
    onChange({ ...value, speakerColors: next })
  }

  const speakerOrder = useMemo(() => speakerOrderFromSegments(segments), [segments])
  const showSpeakerSection = speakerOrder.length >= 2

  const activePreset = useMemo(() => findActivePreset(value), [value])

  return (
    <div className="p-4 space-y-4 text-sm">
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-white/40">
          Style Presets
        </div>
        <div className="grid grid-cols-2 gap-2">
          {STYLE_PRESETS.map((p) => {
            const font = FONT_STACKS[p.style.font] || { stack: 'inherit', weight: 700 }
            const isActive = activePreset?.id === p.id
            return (
              <button
                key={p.id}
                onClick={() => onChange(applyPreset(p, value))}
                title={`Apply "${p.name}" preset`}
                className={`
                  flex items-center justify-center px-2 py-2 rounded transition-all
                  ${isActive
                    ? 'ring-2 ring-purple-400 ring-offset-2 ring-offset-[#0b0b0f]'
                    : 'hover:bg-white/5 ring-1 ring-white/10'}
                `}
                style={{
                  backgroundColor: p.style.highlightTransparent ? 'rgba(255,255,255,0.02)' : p.style.highlightColor,
                }}
              >
                <span
                  style={{
                    fontFamily: font.stack,
                    fontWeight: font.weight,
                    color: p.style.textColor,
                    WebkitTextStroke: `0.5px ${p.style.outlineColor}`,
                    fontSize: '0.95rem',
                    lineHeight: 1,
                  }}
                >
                  {p.name}
                </span>
              </button>
            )
          })}
        </div>
        <div className="text-[10px] text-white/30">
          {activePreset ? `Using ${activePreset.name}` : 'Custom — tweak any field below'}
        </div>
      </div>

      <div className="border-t border-white/10 -mx-4" />

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

      {!showSpeakerSection && (
        <ColorPicker label="Text" value={value.textColor} onChange={(v) => set('textColor', v)} />
      )}
      <ColorPicker label="Outline"   value={value.outlineColor}   onChange={(v) => set('outlineColor', v)} />

      {showSpeakerSection && (
        <div className="space-y-1 rounded bg-white/[0.025] border border-white/10 p-2">
          <div className="text-[11px] uppercase tracking-wide text-white/40 mb-1">
            Speaker Colors
          </div>
          {speakerOrder.map((label) => {
            const override = (value.speakerColors || {})[label]
            const effective = colorForSpeaker(label, speakerOrder, value.textColor, value.speakerColors)
            return (
              <div key={label} className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <ColorPicker
                    label={label}
                    value={effective}
                    onChange={(v) => setSpeakerColor(label, v)}
                  />
                </div>
                <button
                  onClick={() => clearSpeakerColor(label)}
                  disabled={!override}
                  className="text-[10px] px-2 py-1 rounded text-white/40 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                  title={override ? 'Revert to auto-assigned color' : 'Using auto-assigned color'}
                >
                  ⟲
                </button>
              </div>
            )
          })}
        </div>
      )}
      <div className="space-y-1">
        <ColorPicker label="Highlight" value={value.highlightColor} onChange={(v) => set('highlightColor', v)} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/70">Background</span>
          <div className="flex gap-1">
            {[
              { val: false, label: 'On' },
              { val: true,  label: 'Off' },
            ].map((b) => (
              <button
                key={b.label}
                onClick={() => set('highlightTransparent', b.val)}
                className={`px-3 py-1 rounded text-xs ${
                  Boolean(value.highlightTransparent) === b.val ? 'bg-purple-500' : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </div>

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
