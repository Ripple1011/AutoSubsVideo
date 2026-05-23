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
}) {
  const videoRef = useRef(null)
  const [aspectRatio, setAspectRatio] = useState('9 / 16')

  const handleLoadedMetadata = (e) => {
    const v = e.currentTarget
    if (v.videoWidth > 0 && v.videoHeight > 0) {
      setAspectRatio(`${v.videoWidth} / ${v.videoHeight}`)
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
    <div
      className="relative bg-black rounded-lg overflow-hidden max-h-[88vh] max-w-full"
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
              color: colorForSpeaker(current.speaker, speakerOrder, style.textColor),
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
  )
}
