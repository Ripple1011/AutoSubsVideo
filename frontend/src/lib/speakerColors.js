// Distinct colors assigned to additional speakers (Speaker 2, 3, ...) in
// order of first appearance across the segment list. The FIRST speaker keeps
// the user's configured textColor so single-speaker content is unaffected.
export const SPEAKER_PALETTE = ['#FFE066', '#66E0FF', '#FF99CC', '#99FF99', '#FFCC66']

// Build the speakers-in-order-of-first-appearance list from segments. Used
// to map each speaker label to a stable color slot. Stable across re-renders
// when segments don't change reference.
export function speakerOrderFromSegments(segments) {
  const seen = []
  for (const s of segments) {
    if (s.speaker && !seen.includes(s.speaker)) seen.push(s.speaker)
  }
  return seen
}

// Resolve a speaker label to a color string. Priority:
//   1. `overrides[speaker]` if set — explicit user choice in DesignControls.
//   2. `defaultColor` for the first speaker (idx 0) or when no speaker info.
//   3. SPEAKER_PALETTE cycling for subsequent speakers.
// `overrides` is the `style.speakerColors` map; safe to omit (defaults to {}).
export function colorForSpeaker(speaker, speakerOrder, defaultColor, overrides = {}) {
  if (speaker && overrides && overrides[speaker]) return overrides[speaker]
  if (!speaker) return defaultColor
  const idx = speakerOrder.indexOf(speaker)
  if (idx <= 0) return defaultColor
  return SPEAKER_PALETTE[(idx - 1) % SPEAKER_PALETTE.length]
}
