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
export default function SubtitleSidebar({ segments, activeIndex, onSelect, onEdit, style }) {
  const updateText = (i, text) => {
    const next = segments.map((s, idx) => (idx === i ? { ...s, text } : s))
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

  return (
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
            <div className="text-xs text-white/40 mb-1 flex items-center gap-2">
              <span>{fmt(s.start)} → {fmt(s.end)}</span>
              {showSpeakerLabels && s.speaker && (
                <span className="text-white/30">· {s.speaker}</span>
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
  )
}

function fmt(seconds) {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(2).padStart(5, '0')
  return `${m}:${s}`
}
