import logoFull from '../assets/logo.png'
import logoEmblem from '../assets/logo-emblem.png'

// The brand emblem, drawn from the actual logo artwork so the app and the
// installed icon always match.
//
// Below ~64px the full badge's wordmark and icon row become unreadable, so small
// marks use the emblem crop (the AI cloud raining into the bowl) instead.
export default function BrandMark({ size = 28, full = false, style }) {
  const src = full || size >= 64 ? logoFull : logoEmblem
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ display: 'block', objectFit: 'contain', flexShrink: 0, ...style }}
    />
  )
}
