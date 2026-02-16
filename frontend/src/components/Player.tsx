import { type ReactNode, useMemo } from 'react'
import { useAudio } from '../audio'
import VolumeSlider from './VolumeSlider'
import Waveform from './Waveform'

function IconWrap({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className || 'h-5 w-5'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export default function Player() {
  const { current, isPlaying, toggle, next, prev, volume, setVolume } = useAudio()

  const duration = useMemo(() => {
    if (!current) return '0:00'
    const m = Math.floor(current.duration / 60)
    const s = current.duration % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }, [current])

  return (
    <div className="player-v2 relative pb-5">
      <div className="glass-orb glass-orb-top" />
      <div className="glass-orb glass-orb-bottom" />

      <section className="hero-glass-card relative mx-auto w-full max-w-[370px] overflow-hidden rounded-[28px]">
        {current && (
          <img
            src={current.cover_url}
            alt={current.title}
            className="h-[280px] w-full object-cover opacity-25 saturate-50"
          />
        )}
        {!current && <div className="h-[280px] w-full bg-[#141a32]" />}
        <div className="hero-glass-layer" />
        <div className="hero-ring hero-ring-a" />
        <div className="hero-ring hero-ring-b" />
        <div className="hero-ring hero-ring-c" />
      </section>

      <section className="glass-panel mt-4 p-4">
        <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-white">
          {current?.title || 'Loading...'}
        </h1>
        <p className="text-sm text-white/70">{current?.artist || 'Please wait'}</p>
      </section>

      <section className="glass-panel mt-3 p-3">
        <div className="grid grid-cols-4 gap-2">
          <button className="utility-btn" type="button" aria-label="Wave">
            <IconWrap>
              <path d="M4 13v-2" />
              <path d="M8 15v-6" />
              <path d="M12 17V7" />
              <path d="M16 15V9" />
              <path d="M20 13v-2" />
            </IconWrap>
          </button>
          <button className="utility-btn" type="button" aria-label="Timer">
            <IconWrap>
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v5l3 2" />
            </IconWrap>
          </button>
          <button className="utility-btn" type="button" aria-label="Repeat">
            <IconWrap>
              <path d="M17 2l3 3-3 3" />
              <path d="M3 11V9a4 4 0 0 1 4-4h13" />
              <path d="M7 22l-3-3 3-3" />
              <path d="M21 13v2a4 4 0 0 1-4 4H4" />
            </IconWrap>
          </button>
          <button className="utility-btn" type="button" aria-label="Shuffle">
            <IconWrap>
              <path d="M16 3h5v5" />
              <path d="M4 20L21 3" />
              <path d="M21 16v5h-5" />
              <path d="M15 15l6 6" />
              <path d="M4 4l5 5" />
            </IconWrap>
          </button>
        </div>
      </section>

      <section className="glass-panel relative mt-3 p-3">
        <Waveform />
        <div className="pointer-events-none absolute inset-x-0 top-[50%] flex -translate-y-[52%] items-center justify-center gap-2 sm:gap-3">
          <button
            onClick={prev}
            className="transport-btn pointer-events-auto h-11 w-11"
            aria-label="Skip back"
          >
            <IconWrap className="h-5 w-5">
              <path d="M19 7v10" />
              <path d="M17 17l-8-5 8-5v10Z" fill="currentColor" stroke="none" />
              <path d="M9 17 1 12l8-5v10Z" fill="currentColor" stroke="none" />
            </IconWrap>
          </button>
          <button
            onClick={prev}
            className="transport-btn pointer-events-auto h-14 w-14"
            aria-label="Previous"
          >
            <IconWrap className="h-6 w-6">
              <path d="M16 7v10" />
              <path d="M14 17 4 12l10-5v10Z" fill="currentColor" stroke="none" />
            </IconWrap>
          </button>
          <button
            onClick={toggle}
            className="play-btn pointer-events-auto h-[74px] w-[74px]"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <IconWrap className="h-7 w-7">
                <path d="M8 6h3v12H8z" fill="currentColor" stroke="none" />
                <path d="M13 6h3v12h-3z" fill="currentColor" stroke="none" />
              </IconWrap>
            ) : (
              <IconWrap className="h-7 w-7">
                <path d="M8 6.5v11l9-5.5L8 6.5Z" fill="currentColor" stroke="none" />
              </IconWrap>
            )}
          </button>
          <button
            onClick={next}
            className="transport-btn pointer-events-auto h-14 w-14"
            aria-label="Next"
          >
            <IconWrap className="h-6 w-6">
              <path d="M8 7v10" />
              <path d="M10 17l10-5-10-5v10Z" fill="currentColor" stroke="none" />
            </IconWrap>
          </button>
          <button
            onClick={next}
            className="transport-btn pointer-events-auto h-11 w-11"
            aria-label="Skip forward"
          >
            <IconWrap className="h-5 w-5">
              <path d="M5 7v10" />
              <path d="M7 17l8-5-8-5v10Z" fill="currentColor" stroke="none" />
              <path d="M15 17l8-5-8-5v10Z" fill="currentColor" stroke="none" />
            </IconWrap>
          </button>
        </div>
        <div className="absolute bottom-4 left-4 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white/85">
          0:00
        </div>
        <div className="absolute bottom-4 right-4 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white/85">
          {duration}
        </div>
      </section>

      <section className="glass-panel mt-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-[0.2em] text-white/60">Volume</span>
          <span className="text-xs text-white/70">{Math.round(volume * 100)}%</span>
        </div>
        <div className="mt-3">
          <VolumeSlider value={volume} onChange={setVolume} />
        </div>
      </section>

      <nav className="glass-dock mt-4 grid grid-cols-4 gap-2 p-2">
        <button className="dock-btn dock-btn-active" type="button" aria-label="Library">
          <IconWrap>
            <circle cx="8" cy="8" r="2.5" />
            <circle cx="16" cy="8" r="2.5" />
            <circle cx="8" cy="16" r="2.5" />
            <circle cx="16" cy="16" r="2.5" />
          </IconWrap>
        </button>
        <button className="dock-btn" type="button" aria-label="Player">
          <IconWrap>
            <path d="M6 17V9" />
            <path d="M10 17V7" />
            <path d="M14 17V11" />
            <path d="M18 17V5" />
          </IconWrap>
        </button>
        <button className="dock-btn" type="button" aria-label="Search">
          <IconWrap>
            <circle cx="11" cy="11" r="6.5" />
            <path d="m20 20-4.2-4.2" />
          </IconWrap>
        </button>
        <button className="dock-btn" type="button" aria-label="Menu">
          <IconWrap>
            <path d="M5 7h14" />
            <path d="M5 12h14" />
            <path d="M5 17h14" />
          </IconWrap>
        </button>
      </nav>
    </div>
  )
}
