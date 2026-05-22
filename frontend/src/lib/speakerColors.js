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

// Resolve a speaker label to a color string. First speaker (or no speaker
// info) returns `defaultColor` so single-speaker videos render exactly as
// before. Subsequent speakers cycle through SPEAKER_PALETTE.
export function colorForSpeaker(speaker, speakerOrder, defaultColor) {
  if (!speaker) return defaultColor
  const idx = speakerOrder.indexOf(speaker)
  if (idx <= 0) return defaultColor
  return SPEAKER_PALETTE[(idx - 1) % SPEAKER_PALETTE.length]
}
