import { useMemo } from 'react'
import { colorForSpeaker, speakerOrderFromSegments } from '../lib/speakerColors'

/**
 * Left column — editable timestamped script blocks.
 * Clicking a block scrubs the right-canvas video to that segment.
 *
 * Each row carries a 3px left stripe in the segment's speaker color and,
 * when 2+ distinct speakers are present, a small `Speaker N` label next to
 * the timestamp so the creator can see speaker assignments at a glance.
 * Single-speaker transcripts hide the label (stripe stays neutral white).
 */
// Nudge increments for the timing-step buttons. Shift+click multiplies a
// click into the coarse step — useful when a sub is multiple seconds off
// and the user doesn't want to mash the button.
const STEP_FINE = 0.1
const STEP_COARSE = 1.0
// Minimum window we'll let a segment shrink to before clamping kicks in.
// Below this you can't tell the sub apart from a flash.
const MIN_DURATION = 0.05

export default function SubtitleSidebar({ segments, originalSegments, activeIndex, onSelect, onEdit, style }) {
  const updateText = (i, text) => {
    const next = segments.map((s, idx) => (idx === i ? { ...s, text } : s))
    onEdit(next)
  }

  const updateTiming = (i, start, end) => {
    // Clamp before writing so the segment is always renderable.
    let s = Math.max(0, start)
    let e = end
    if (e <= s) e = s + MIN_DURATION
    if (s >= e) s = e - MIN_DURATION
    if (s < 0) s = 0
    const next = segments.map((seg, idx) => (idx === i ? { ...seg, start: s, end: e } : seg))
    onEdit(next)
  }

  const speakerOrder = useMemo(() => speakerOrderFromSegments(segments), [segments])
  const overrides = style?.speakerColors
  const showSpeakerLabels = speakerOrder.length >= 2

  if (segments.length === 0) {
    return (
      <div className="p-6 text-white/40 text-sm">
        Transcription will appear here once processing completes.
      </div>
    )
  }

  // Reference inequality is sufficient — every text / timing edit creates a
  // new segments array via .map(), so segments !== originalSegments iff the
  // user has touched something this session.
  const hasEdits = originalSegments && segments !== originalSegments

  return (
    <>
      {hasEdits && (
        <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between bg-amber-500/5">
          <span className="text-[11px] text-amber-200/70">Unsaved edits</span>
          <button
            onClick={() => onEdit(originalSegments)}
            className="text-[11px] text-amber-200/80 hover:text-amber-100 hover:underline"
            title="Restore segments to the originally transcribed values"
          >
            ↻ Reset all
          </button>
        </div>
      )}
      <ul className="divide-y divide-white/5">
      {segments.map((s, i) => {
        const stripeColor = colorForSpeaker(s.speaker, speakerOrder, '#FFFFFF', overrides)
        return (
          <li
            key={i}
            className={`p-3 cursor-pointer border-l-[3px] ${i === activeIndex ? 'bg-white/10' : 'hover:bg-white/5'}`}
            style={{ borderLeftColor: stripeColor }}
            onClick={() => onSelect(i)}
          >
            <div
              className="text-xs text-white/40 mb-1 flex items-center gap-1.5 group/timing"
              onClick={(e) => e.stopPropagation()}
              title="Shift-click ± for 1s coarse step"
            >
              <TimeStepper
                value={s.start}
                onDelta={(delta) => updateTiming(i, s.start + delta, s.end)}
              />
              <span className="text-white/30">→</span>
              <TimeStepper
                value={s.end}
                onDelta={(delta) => updateTiming(i, s.start, s.end + delta)}
              />
              {showSpeakerLabels && s.speaker && (
                <span className="text-white/30 ml-1">· {s.speaker}</span>
              )}
            </div>
            <input
              value={s.text}
              onChange={(e) => updateText(i, e.target.value)}
              className="w-full bg-transparent outline-none text-sm"
            />
          </li>
        )
      })}
      </ul>
    </>
  )
}

function fmt(seconds) {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(2).padStart(5, '0')
  return `${m}:${s}`
}

/**
 * Inline timestamp display with ± buttons that nudge by 0.1s (or 1.0s when
 * Shift is held). The buttons are low-opacity by default and brighten on
 * row hover so dense lists stay readable. onDelta receives the signed step
 * — the parent decides which field (start or end) it applies to.
 */
function TimeStepper({ value, onDelta }) {
  const step = (sign) => (e) => {
    e.stopPropagation()
    const mag = e.shiftKey ? STEP_COARSE : STEP_FINE
    onDelta(sign * mag)
  }
  return (
    <span className="inline-flex items-center gap-0.5 font-mono">
      <button
        onClick={step(-1)}
        className="px-1 rounded text-white/30 hover:text-white hover:bg-white/10 opacity-50 group-hover/timing:opacity-100 leading-none"
        tabIndex={-1}
        aria-label="Step earlier"
      >
        −
      </button>
      <span className="tabular-nums select-none">{fmt(value)}</span>
      <button
        onClick={step(+1)}
        className="px-1 rounded text-white/30 hover:text-white hover:bg-white/10 opacity-50 group-hover/timing:opacity-100 leading-none"
        tabIndex={-1}
        aria-label="Step later"
      >
        +
      </button>
    </span>
  )
}
