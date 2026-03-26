import { useEffect, useRef, useState } from 'react'

export default function VolumeSlider({
  value,
  onChange,
  disabled = false,
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)

  const percent = Math.max(0, Math.min(1, value)) * 100

  const updateFromClientX = (clientX: number) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const next = (clientX - rect.left) / rect.width
    onChange(Math.max(0, Math.min(1, next)))
  }

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging || disabled) return
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      updateFromClientX(clientX)
    }
    const onUp = () => setDragging(false)

    window.addEventListener('mousemove', onMove)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchend', onUp)

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchend', onUp)
    }
  }, [disabled, dragging])

  return (
    <div
      ref={trackRef}
      className="volume-track"
      onMouseDown={(e) => {
        if (disabled) return
        setDragging(true)
        updateFromClientX(e.clientX)
      }}
      onTouchStart={(e) => {
        if (disabled) return
        setDragging(true)
        updateFromClientX(e.touches[0].clientX)
      }}
      aria-disabled={disabled}
    >
      <div
        className="absolute left-0 top-0 h-full rounded-full bg-white/20"
        style={{ width: `${percent}%` }}
      />
      <div
        className="volume-thumb absolute -top-1"
        style={{ left: `calc(${percent}% - 9px)` }}
      />
    </div>
  )
}
