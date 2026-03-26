import { type ReactNode, useMemo, useCallback, useRef, useState, useEffect } from 'react'
import { useAudio } from '../audio'
import VolumeSlider from './VolumeSlider'
import Waveform from './Waveform'
import AudioVisualizer from './AudioVisualizer'

type PlayerView = 'player' | 'library'
type SortMode = 'newest' | 'title' | 'duration'

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

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const fraction = value >= 10 || index === 0 ? 0 : 1
  return `${value.toFixed(fraction)} ${units[index]}`
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function daysUntil(value: string | null | undefined) {
  if (!value) return null
  const target = new Date(value)
  if (Number.isNaN(target.getTime())) return null
  const diffMs = target.getTime() - Date.now()
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000))
}

export default function Player() {
  const {
    tracks,
    current,
    currentIndex,
    isPlaying,
    isLoading,
    authError,
    billingError,
    plans,
    planCode,
    quotaLimitBytes,
    quotaUsedBytes,
    toggle,
    nextTrack,
    previousTrack,
    skipForward,
    skipBackward,
    volume,
    setVolume,
    currentTime,
    duration,
    seekTo,
    selectTrack,
    shuffleEnabled,
    repeatMode,
    visualizationEnabled,
    toggleShuffle,
    cycleRepeatMode,
    toggleVisualization,
    refreshBilling,
    changePlan,
    createStarsInvoice,
    deleteTrack,
    refreshTracks,
    syncTracks,
  } = useAudio()
  const progressTrackRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [seeking, setSeeking] = useState(false)
  const [view, setView] = useState<PlayerView>('player')
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [searchQuery, setSearchQuery] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isPlanRefreshing, setIsPlanRefreshing] = useState(false)
  const [planUpdatingCode, setPlanUpdatingCode] = useState<string | null>(null)
  const [deletingTrackId, setDeletingTrackId] = useState<string | null>(null)
  const [showImportHint, setShowImportHint] = useState(false)
  const hasTrack = Boolean(current)
  const botUsername = ((import.meta.env.VITE_BOT_USERNAME as string | undefined) || '').replace(/^@/, '')
  const botLink = botUsername ? `https://t.me/${botUsername}` : ''

  const playableDuration = useMemo(() => {
    if (duration > 0) return duration
    return current?.duration || 0
  }, [current?.duration, duration])

  const progressPercent = useMemo(() => {
    if (!playableDuration) return 0
    return Math.min(100, (currentTime / playableDuration) * 100)
  }, [currentTime, playableDuration])

  const quotaPercent = useMemo(() => {
    if (quotaLimitBytes <= 0) return 0
    return Math.min(100, (quotaUsedBytes / quotaLimitBytes) * 100)
  }, [quotaLimitBytes, quotaUsedBytes])

  const sortedPlans = useMemo(
    () => [...plans].sort((a, b) => a.quota_limit_bytes - b.quota_limit_bytes || a.code.localeCompare(b.code)),
    [plans]
  )
  const currentPlanInfo = useMemo(() => sortedPlans.find((plan) => plan.code === planCode) || null, [sortedPlans, planCode])
  const currentPlanExpiryLabel = useMemo(
    () => formatDateTime(currentPlanInfo?.subscription_expires_at),
    [currentPlanInfo?.subscription_expires_at]
  )
  const currentPlanDaysLeft = useMemo(
    () => daysUntil(currentPlanInfo?.subscription_expires_at),
    [currentPlanInfo?.subscription_expires_at]
  )

  const filteredTracks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const next = tracks
      .map((track, index) => ({ ...track, listIndex: index }))
      .filter((track) => {
        if (!query) return true
        const haystack = `${track.title} ${track.artist}`.toLowerCase()
        return haystack.includes(query)
      })

    if (sortMode === 'title') {
      next.sort((a, b) => a.title.localeCompare(b.title))
    } else if (sortMode === 'duration') {
      next.sort((a, b) => b.duration - a.duration)
    } else {
      next.sort((a, b) => Number(b.id) - Number(a.id))
    }
    return next
  }, [searchQuery, sortMode, tracks])

  const seekByClientX = useCallback(
    (clientX: number) => {
      if (!progressTrackRef.current || playableDuration <= 0) return
      const rect = progressTrackRef.current.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      seekTo(ratio * playableDuration)
    },
    [playableDuration, seekTo]
  )

  useEffect(() => {
    if (!seeking) return
    const onMove = (event: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in event ? event.touches[0]?.clientX : event.clientX
      if (typeof clientX === 'number') seekByClientX(clientX)
    }
    const onUp = () => setSeeking(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchend', onUp)
    }
  }, [seekByClientX, seeking])

  const refreshLibrary = useCallback(async () => {
    setIsRefreshing(true)
    await refreshTracks()
    setIsRefreshing(false)
  }, [refreshTracks])

  const refreshPlanState = useCallback(async () => {
    setIsPlanRefreshing(true)
    await refreshBilling()
    setIsPlanRefreshing(false)
  }, [refreshBilling])

  const openInvoice = useCallback(async (invoiceLink: string) => {
    const webApp = (window as any).Telegram?.WebApp
    if (typeof webApp?.openInvoice === 'function') {
      const status = await new Promise<string>((resolve) => {
        webApp.openInvoice(invoiceLink, (invoiceStatus: string) => resolve(String(invoiceStatus || 'unknown')))
      })
      return status
    }
    window.open(invoiceLink, '_blank', 'noopener,noreferrer')
    return 'opened'
  }, [])

  const handlePlanChange = useCallback(
    async (plan: { code: string; is_available?: boolean; stars_price?: number | null }) => {
      if (plan.code === planCode || planUpdatingCode) return
      setPlanUpdatingCode(plan.code)
      const isAvailable = plan.is_available ?? false
      try {
        if (isAvailable) {
          await changePlan(plan.code)
          return
        }

        const invoice = await createStarsInvoice(plan.code)
        if (!invoice?.invoice_link) return

        const invoiceStatus = await openInvoice(invoice.invoice_link)
        if (invoiceStatus === 'paid' || invoiceStatus === 'opened') {
          await refreshPlanState()
          await new Promise((resolve) => window.setTimeout(resolve, 1500))
          await refreshPlanState()
        }
      } finally {
        setPlanUpdatingCode(null)
      }
    },
    [changePlan, createStarsInvoice, openInvoice, planCode, planUpdatingCode, refreshPlanState]
  )

  useEffect(() => {
    if (view !== 'library') return
    void syncTracks()
    const intervalId = window.setInterval(() => {
      void syncTracks()
    }, 8000)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [syncTracks, view])

  const openBot = useCallback(() => {
    if (!botLink) return
    const webApp = (window as any).Telegram?.WebApp
    if (typeof webApp?.openTelegramLink === 'function') {
      webApp.openTelegramLink(botLink)
      return
    }
    window.open(botLink, '_blank', 'noopener,noreferrer')
  }, [botLink])

  const openSearch = useCallback(() => {
    setView('library')
    setTimeout(() => {
      searchRef.current?.focus()
    }, 40)
  }, [])

  const openTrackFromLibrary = useCallback(
    (trackIndex: number) => {
      selectTrack(trackIndex, true)
      setView('player')
    },
    [selectTrack]
  )

  const handleDeleteTrack = useCallback(
    async (trackId: string, title: string) => {
      if (deletingTrackId) return
      const approved = window.confirm(`Delete "${title}"?`)
      if (!approved) return
      setDeletingTrackId(trackId)
      await deleteTrack(trackId)
      setDeletingTrackId(null)
    },
    [deleteTrack, deletingTrackId]
  )

  const mainTitle = useMemo(() => {
    if (view === 'library') return 'Library'
    if (isLoading) return 'Loading...'
    return current?.title || 'Your Library Is Empty'
  }, [current?.title, isLoading, view])

  const subtitle = useMemo(() => {
    if (view === 'library') {
      if (isLoading) return 'Syncing tracks...'
      return `${tracks.length} track${tracks.length === 1 ? '' : 's'}`
    }
    if (isLoading) return 'Please wait'
    return current?.artist || 'Add tracks via bot import to start playback'
  }, [current?.artist, isLoading, tracks.length, view])

  const errorText = useMemo(() => {
    if (authError === 'Authentication failed') return 'Open from Telegram Mini App or enable DEV auth on backend'
    if (authError === 'Failed to load tracks') return 'Track list request failed, check backend and refresh'
    if (authError === 'Failed to sync tracks') return 'Auto-sync failed, check backend and press Refresh'
    if (authError === 'Failed to delete track') return 'Track delete failed, retry from Library'
    return authError
  }, [authError])

  const formattedCurrentTime = useMemo(() => formatTime(currentTime), [currentTime])
  const formattedDuration = useMemo(() => {
    if (!current) return '0:00'
    return formatTime(duration || current.duration)
  }, [current, duration])

  return (
    <div className="player-v2 relative pb-5">
      <div className="glass-orb glass-orb-top" />
      <div className="glass-orb glass-orb-bottom" />

      <section className="hero-glass-card relative mx-auto w-full max-w-[370px] overflow-hidden rounded-[28px]">
        {current && (
          <img
            src={current.cover_url}
            alt={current.title}
            className={`h-[280px] w-full object-cover saturate-50 transition-opacity duration-300 ${
              visualizationEnabled ? 'opacity-10' : 'opacity-25'
            }`}
          />
        )}
        {!current && <div className="h-[280px] w-full bg-[#141a32]" />}
        <AudioVisualizer />
        <div className="hero-glass-layer" />
        <div className="hero-ring hero-ring-a" />
        <div className="hero-ring hero-ring-b" />
        <div className="hero-ring hero-ring-c" />
      </section>

      <section className="glass-panel mt-4 p-4">
        <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-white">{mainTitle}</h1>
        <p className="text-sm text-white/70">{subtitle}</p>
        {errorText && <p className="mt-2 text-xs text-rose-300">{errorText}</p>}
      </section>

      <section className="glass-panel mt-3 p-4">
        <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/60">
          <span>{planCode.toUpperCase()} Plan</span>
          <div className="flex items-center gap-2">
            <span>{Math.round(quotaPercent)}%</span>
            <button
              type="button"
              className="text-[10px] uppercase tracking-[0.14em] text-white/60 transition hover:text-white disabled:opacity-40"
              onClick={() => {
                void refreshPlanState()
              }}
              disabled={isPlanRefreshing || Boolean(planUpdatingCode)}
            >
              {isPlanRefreshing ? '...' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="quota-track">
          <div className="quota-fill" style={{ width: `${quotaPercent}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-white/70">
          <span>{formatBytes(quotaUsedBytes)} used</span>
          <span>{formatBytes(quotaLimitBytes)} total</span>
        </div>
        {planCode !== 'free' && currentPlanExpiryLabel && (
          <p className={`mt-2 text-xs ${currentPlanDaysLeft !== null && currentPlanDaysLeft <= 3 ? 'text-amber-300' : 'text-white/70'}`}>
            Active until {currentPlanExpiryLabel}
            {currentPlanDaysLeft !== null && currentPlanDaysLeft <= 3 ? ` · ${Math.max(currentPlanDaysLeft, 0)}d left` : ''}
          </p>
        )}
        {sortedPlans.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {sortedPlans.map((plan) => {
              const isActive = plan.code === planCode
              const isAvailable = plan.is_available ?? isActive
              const isBusy = planUpdatingCode === plan.code
              const expiresLabel = formatDateTime(plan.subscription_expires_at)
              const actionLabel = isActive ? 'Current' : isAvailable ? 'Switch' : 'Upgrade'
              const starsLabel = !isAvailable && !isActive && (plan.stars_price || 0) > 0 ? `${plan.stars_price} Stars` : null
              return (
                <button
                  key={plan.code}
                  type="button"
                  className={`plan-chip ${isActive ? 'plan-chip-active' : ''} ${!isAvailable && !isActive ? 'plan-chip-locked' : ''}`}
                  onClick={() => {
                    void handlePlanChange(plan)
                  }}
                  disabled={isBusy || Boolean(planUpdatingCode)}
                >
                  <span>{plan.name} · {actionLabel}</span>
                  <span className="plan-chip-meta">{formatBytes(plan.quota_limit_bytes)}</span>
                  {starsLabel && <span className="plan-chip-meta">{starsLabel}</span>}
                  {!isActive && expiresLabel && <span className="plan-chip-meta">until {expiresLabel}</span>}
                  {!isActive && !isAvailable && !expiresLabel && <span className="plan-chip-meta">payment required</span>}
                  {isBusy && <span className="plan-chip-meta">...</span>}
                </button>
              )
            })}
          </div>
        )}
        {billingError && <p className="mt-2 text-xs text-rose-300">{billingError}</p>}
      </section>

      {view === 'player' && (
        <>
          <section className="glass-panel mt-3 p-3">
            <div className="grid grid-cols-4 gap-2">
              <button
                className={`utility-btn ${visualizationEnabled ? 'opacity-100' : 'opacity-60'}`}
                type="button"
                aria-label="Wave"
                onClick={toggleVisualization}
                disabled={!hasTrack}
              >
                <IconWrap>
                  <path d="M4 13v-2" />
                  <path d="M8 15v-6" />
                  <path d="M12 17V7" />
                  <path d="M16 15V9" />
                  <path d="M20 13v-2" />
                </IconWrap>
              </button>
              <button className="utility-btn" type="button" aria-label="Timer" disabled={!hasTrack}>
                <IconWrap>
                  <circle cx="12" cy="12" r="8" />
                  <path d="M12 8v5l3 2" />
                </IconWrap>
              </button>
              <button
                className={`utility-btn ${repeatMode !== 'off' ? 'opacity-100' : 'opacity-60'}`}
                type="button"
                aria-label="Repeat"
                onClick={cycleRepeatMode}
                disabled={!hasTrack}
              >
                <IconWrap>
                  {repeatMode === 'one' ? (
                    <>
                      <path d="M17 2l3 3-3 3" />
                      <path d="M3 11V9a4 4 0 0 1 4-4h13" />
                      <path d="M7 22l-3-3 3-3" />
                      <path d="M21 13v2a4 4 0 0 1-4 4H4" />
                      <circle cx="12" cy="12" r="3" fill="currentColor" />
                    </>
                  ) : (
                    <>
                      <path d="M17 2l3 3-3 3" />
                      <path d="M3 11V9a4 4 0 0 1 4-4h13" />
                      <path d="M7 22l-3-3 3-3" />
                      <path d="M21 13v2a4 4 0 0 1-4 4H4" />
                    </>
                  )}
                </IconWrap>
              </button>
              <button
                className={`utility-btn ${shuffleEnabled ? 'opacity-100' : 'opacity-60'}`}
                type="button"
                aria-label="Shuffle"
                onClick={toggleShuffle}
                disabled={!hasTrack}
              >
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
            <div className="mb-3">
              <div
                ref={progressTrackRef}
                className="music-progress"
                role="slider"
                aria-label="Track progress"
                aria-valuemin={0}
                aria-valuemax={Math.floor(playableDuration)}
                aria-valuenow={Math.floor(currentTime)}
                tabIndex={0}
                aria-disabled={!hasTrack}
                onMouseDown={(event) => {
                  if (!hasTrack) return
                  seekByClientX(event.clientX)
                  setSeeking(true)
                }}
                onTouchStart={(event) => {
                  if (!hasTrack) return
                  const clientX = event.touches[0]?.clientX
                  if (typeof clientX === 'number') seekByClientX(clientX)
                  setSeeking(true)
                }}
                onKeyDown={(event) => {
                  if (!hasTrack) return
                  if (event.key === 'ArrowLeft') seekTo(Math.max(0, currentTime - 5))
                  if (event.key === 'ArrowRight') seekTo(Math.min(playableDuration, currentTime + 5))
                }}
              >
                <div className="music-progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-white/70">
                <span>{formattedCurrentTime}</span>
                <span>{formattedDuration}</span>
              </div>
            </div>
            <div className="pointer-events-none">
              <Waveform />
            </div>
            <div className="absolute inset-x-0 top-[50%] z-50 flex -translate-y-[52%] items-center justify-center gap-2 sm:gap-3">
              <button
                onClick={skipBackward}
                className="transport-btn h-11 w-11 cursor-pointer"
                aria-label="Skip back"
                type="button"
                disabled={!hasTrack}
              >
                <IconWrap className="h-5 w-5">
                  <path d="M19 7v10" />
                  <path d="M17 17l-8-5 8-5v10Z" fill="currentColor" stroke="none" />
                  <path d="M9 17 1 12l8-5v10Z" fill="currentColor" stroke="none" />
                </IconWrap>
              </button>
              <button
                onClick={previousTrack}
                className="transport-btn h-14 w-14 cursor-pointer"
                aria-label="Previous"
                type="button"
                disabled={!hasTrack}
              >
                <IconWrap className="h-6 w-6">
                  <path d="M16 7v10" />
                  <path d="M14 17 4 12l10-5v10Z" fill="currentColor" stroke="none" />
                </IconWrap>
              </button>
              <button
                onClick={() => {
                  void toggle()
                }}
                className="play-btn h-[74px] w-[74px] cursor-pointer"
                aria-label={isPlaying ? 'Pause' : 'Play'}
                type="button"
                disabled={!hasTrack}
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
                onClick={nextTrack}
                className="transport-btn h-14 w-14 cursor-pointer"
                aria-label="Next"
                type="button"
                disabled={!hasTrack}
              >
                <IconWrap className="h-6 w-6">
                  <path d="M8 7v10" />
                  <path d="M10 17l10-5-10-5v10Z" fill="currentColor" stroke="none" />
                </IconWrap>
              </button>
              <button
                onClick={skipForward}
                className="transport-btn h-11 w-11 cursor-pointer"
                aria-label="Skip forward"
                type="button"
                disabled={!hasTrack}
              >
                <IconWrap className="h-5 w-5">
                  <path d="M5 7v10" />
                  <path d="M7 17l8-5-8-5v10Z" fill="currentColor" stroke="none" />
                  <path d="M15 17l8-5-8-5v10Z" fill="currentColor" stroke="none" />
                </IconWrap>
              </button>
            </div>
          </section>

          <section className="glass-panel mt-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.2em] text-white/60">Volume</span>
              <span className="text-xs text-white/70">{Math.round(volume * 100)}%</span>
            </div>
            <div className="mt-3">
              <VolumeSlider value={volume} onChange={setVolume} disabled={!hasTrack} />
            </div>
          </section>
        </>
      )}

      {view === 'library' && (
        <section className="glass-panel mt-3 p-4">
          <div className="flex items-center gap-2">
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search track or artist"
              className="library-input"
            />
            <button
              type="button"
              className="library-action-btn h-[42px] px-3"
              onClick={() => {
                void refreshLibrary()
              }}
            >
              {isRefreshing ? '...' : 'Refresh'}
            </button>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className={`chip-btn ${sortMode === 'newest' ? 'chip-btn-active' : ''}`}
              onClick={() => setSortMode('newest')}
            >
              Newest
            </button>
            <button
              type="button"
              className={`chip-btn ${sortMode === 'title' ? 'chip-btn-active' : ''}`}
              onClick={() => setSortMode('title')}
            >
              Title
            </button>
            <button
              type="button"
              className={`chip-btn ${sortMode === 'duration' ? 'chip-btn-active' : ''}`}
              onClick={() => setSortMode('duration')}
            >
              Duration
            </button>
          </div>

          <div className="library-list mt-4">
            {!filteredTracks.length && (
              <div className="library-empty">
                <p>No tracks found.</p>
                <p className="mt-1 text-white/60">Use Import to send audio to your bot and press Refresh.</p>
              </div>
            )}

            {filteredTracks.map((track) => {
              const isDeleting = deletingTrackId === track.id
              const title = track.title || 'Track'
              return (
                <div key={track.id} className="library-item-row">
                  <button
                    type="button"
                    className={`library-item ${track.listIndex === currentIndex ? 'library-item-active' : ''}`}
                    onClick={() => openTrackFromLibrary(track.listIndex)}
                  >
                    <img src={track.cover_url} alt={track.title} className="library-item-cover" />
                    <div className="min-w-0 text-left">
                      <p className="truncate text-sm font-semibold text-white">{track.title}</p>
                      <p className="truncate text-xs text-white/65">{track.artist}</p>
                    </div>
                    <span className="ml-2 text-xs text-white/65">{formatTime(track.duration || 0)}</span>
                  </button>
                  <button
                    type="button"
                    className="library-delete-btn"
                    onClick={() => {
                      void handleDeleteTrack(track.id, title)
                    }}
                    disabled={isDeleting || Boolean(deletingTrackId)}
                  >
                    {isDeleting ? '...' : 'Delete'}
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {showImportHint && (
        <section className="glass-panel mt-3 p-4 text-sm text-white/80">
          <p className="font-medium text-white">Import tracks</p>
          <p className="mt-1 text-white/70">Send audio or music file to your bot, then press Refresh in Library.</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="library-action-btn px-3 py-2"
              onClick={openBot}
              disabled={!botLink}
            >
              Open bot
            </button>
            <span className="text-xs text-white/60">{botLink ? botLink : 'Set VITE_BOT_USERNAME for quick open'}</span>
          </div>
        </section>
      )}

      <nav className="glass-dock mt-4 grid grid-cols-4 gap-2 p-2">
        <button
          className={`dock-btn ${view === 'library' ? 'dock-btn-active' : ''}`}
          type="button"
          aria-label="Library"
          onClick={() => setView('library')}
        >
          <IconWrap>
            <circle cx="8" cy="8" r="2.5" />
            <circle cx="16" cy="8" r="2.5" />
            <circle cx="8" cy="16" r="2.5" />
            <circle cx="16" cy="16" r="2.5" />
          </IconWrap>
        </button>
        <button
          className={`dock-btn ${view === 'player' ? 'dock-btn-active' : ''}`}
          type="button"
          aria-label="Player"
          onClick={() => setView('player')}
        >
          <IconWrap>
            <path d="M6 17V9" />
            <path d="M10 17V7" />
            <path d="M14 17V11" />
            <path d="M18 17V5" />
          </IconWrap>
        </button>
        <button className="dock-btn" type="button" aria-label="Search" onClick={openSearch}>
          <IconWrap>
            <circle cx="11" cy="11" r="6.5" />
            <path d="m20 20-4.2-4.2" />
          </IconWrap>
        </button>
        <button
          className={`dock-btn ${showImportHint ? 'dock-btn-active' : ''}`}
          type="button"
          aria-label="Import"
          onClick={() => setShowImportHint((prev) => !prev)}
        >
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
