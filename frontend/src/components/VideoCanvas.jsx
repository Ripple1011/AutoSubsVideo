import { useEffect, useMemo, useRef, useState } from 'react'
import { FONT_STACKS } from './DesignControls'
import { colorForSpeaker, speakerOrderFromSegments } from '../lib/speakerColors'

/**
 * Preview canvas. The container takes the source video's natural aspect
 * ratio (read from the <video> element's intrinsic dimensions on
 * loadedmetadata) so landscape and vertical sources both display their
 * full frame instead of being cropped to a fixed shape. Falls back to 9:16
 * before metadata loads so the layout doesn't shift between unloaded and
 * loaded states for the canonical short-form case.
 *
 * Subtitle overlay sits on top via absolute positioning — clicks scrub
 * the video, playback drives the active segment.
 */
export default function VideoCanvas({
  videoUrl,
  segments,
  activeIndex,
  onActiveChange,
  style,
  jobId,
}) {
  const videoRef = useRef(null)
  const [aspectRatio, setAspectRatio] = useState('9 / 16')
  // Burn state for the canvas download button. Kept local rather than lifted
  // because the button is a self-contained shortcut: render + save, no modal
  // round-trip. The Export menu still has its own preview-modal flow.
  const [burning, setBurning] = useState(false)
  const [burnError, setBurnError] = useState(null)

  const handleLoadedMetadata = (e) => {
    const v = e.currentTarget
    if (v.videoWidth > 0 && v.videoHeight > 0) {
      setAspectRatio(`${v.videoWidth} / ${v.videoHeight}`)
    }
  }

  const handleDownloadMp4 = async () => {
    if (!jobId || burning) return
    setBurning(true)
    setBurnError(null)
    try {
      const res = await fetch(`/api/export/hard?job_id=${encodeURIComponent(jobId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(style || {}),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const cd = res.headers.get('content-disposition') || ''
      const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i)
      const filename = match ? decodeURIComponent(match[1]) : 'burned.mp4'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setBurnError(e.message)
    } finally {
      setBurning(false)
    }
  }

  // Speakers in order of first appearance — used to map each speaker label
  // to a stable color slot.
  const speakerOrder = useMemo(() => speakerOrderFromSegments(segments), [segments])

  // Sidebar click → scrub video to that segment's start.
  useEffect(() => {
    const v = videoRef.current
    if (!v || segments.length === 0) return
    const seg = segments[activeIndex]
    if (!seg) return
    // Only scrub if currentTime isn't already inside the target window —
    // avoids fighting the timeupdate handler during normal playback.
    if (v.currentTime < seg.start || v.currentTime >= seg.end) {
      v.currentTime = seg.start
    }
  }, [activeIndex, segments])

  // Playback → flip activeIndex to whichever segment owns currentTime.
  // When no segment owns currentTime (leading silence, between-segment gaps),
  // set activeIndex to -1 so the overlay can hide itself.
  const handleTimeUpdate = () => {
    const v = videoRef.current
    if (!v || segments.length === 0) return
    const t = v.currentTime
    const idx = segments.findIndex((s) => t >= s.start && t < s.end)
    if (idx !== activeIndex) {
      onActiveChange(idx)   // -1 when no segment owns this moment
    }
  }

  const alignmentClass = {
    top: 'items-start pt-8',
    center: 'items-center',
    bottom: 'items-end pb-12',
  }[style.verticalAlignment] || 'items-end pb-12'

  const current = segments[activeIndex]
  const font = FONT_STACKS[style.font] || {
    stack: `${style.font}, "Noto Sans Devanagari", "Noto Sans Gujarati", sans-serif`,
    weight: 700,
  }

  const animClass = style.animation && style.animation !== 'none'
    ? `autosub-anim-${style.animation}`
    : ''
  const animDuration = { fast: '160ms', normal: '280ms', slow: '480ms' }[style.animationSpeed] || '280ms'

  return (
    <div className="flex flex-col gap-3 max-w-full">
      <div
        className="relative bg-black rounded-lg overflow-hidden max-h-[82vh] max-w-full"
        style={{ aspectRatio }}
      >
      {videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          className="w-full h-full object-contain"
          controls
          controlsList="nofullscreen"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/30">
          No video loaded
        </div>
      )}
      {current && (
        <div className={`absolute inset-0 flex justify-center pointer-events-none ${alignmentClass}`}>
          <span
            key={activeIndex}
            className={`px-3 py-1 rounded text-center max-w-[90%] ${animClass}`}
            style={{
              fontFamily: font.stack,
              color: colorForSpeaker(current.speaker, speakerOrder, style.textColor, style.speakerColors),
              backgroundColor: style.highlightTransparent ? 'transparent' : style.highlightColor,
              WebkitTextStroke: `2px ${style.outlineColor}`,
              fontSize: `${2 * style.scale}rem`,
              fontWeight: font.weight,
              lineHeight: 1.15,

              ['--anim-duration']: animDuration,
            }}
          >
            {current.text}
          </span>
        </div>
      )}
      </div>
      {videoUrl && jobId && (
        <div className="flex justify-end items-center gap-3">
          {burnError && (
            <div className="px-2 py-1 text-[11px] rounded bg-rose-500/20 text-rose-200 max-w-[20rem] truncate" title={burnError}>
              {burnError}
            </div>
          )}
          <button
            onClick={handleDownloadMp4}
            disabled={burning}
            className="px-4 py-2 text-sm rounded-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-600 disabled:opacity-70 text-white font-medium shadow-lg shadow-emerald-500/20 transition-colors"
            title="Render and download .mp4 with subtitles burned in"
          >
            {burning ? 'Rendering…' : '↓ Download MP4'}
          </button>
        </div>
      )}
    </div>
  )
}
