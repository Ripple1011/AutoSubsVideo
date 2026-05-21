/**
 * Left column — editable timestamped script blocks.
 * Clicking a block scrubs the right-canvas video to that segment.
 */
export default function SubtitleSidebar({ segments, activeIndex, onSelect, onEdit }) {
  const updateText = (i, text) => {
    const next = segments.map((s, idx) => (idx === i ? { ...s, text } : s))
    onEdit(next)
  }

  if (segments.length === 0) {
    return (
      <div className="p-6 text-white/40 text-sm">
        Transcription will appear here once processing completes.
      </div>
    )
  }

  return (
    <ul className="divide-y divide-white/5">
      {segments.map((s, i) => (
        <li
          key={i}
          className={`p-3 cursor-pointer ${i === activeIndex ? 'bg-white/10' : 'hover:bg-white/5'}`}
          onClick={() => onSelect(i)}
        >
          <div className="text-xs text-white/40 mb-1">
            {fmt(s.start)} → {fmt(s.end)}
          </div>
          <input
            value={s.text}
            onChange={(e) => updateText(i, e.target.value)}
            className="w-full bg-transparent outline-none text-sm"
          />
        </li>
      ))}
    </ul>
  )
}

function fmt(seconds) {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(2).padStart(5, '0')
  return `${m}:${s}`
}
