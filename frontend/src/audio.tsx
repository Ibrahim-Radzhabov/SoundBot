import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import axios from 'axios'

export type Track = {
  id: string
  title: string
  artist: string
  duration: number
  cover_url: string
  stream_url: string
}

export type PlanOption = {
  code: string
  name: string
  quota_limit_bytes: number
  is_current?: boolean
  is_available?: boolean
  subscription_expires_at?: string | null
  stars_price?: number | null
}

export type StarsInvoice = {
  plan_code: string
  invoice_link: string
  stars_amount: number
  period_days: number
}

type NullableIndex = number | null
export type RepeatMode = 'off' | 'all' | 'one'

type AudioContextValue = {
  tracks: Track[]
  current?: Track
  currentIndex: number
  isPlaying: boolean
  isLoading: boolean
  authError: string | null
  billingError: string | null
  plans: PlanOption[]
  planCode: string
  quotaLimitBytes: number
  quotaUsedBytes: number
  volume: number
  currentTime: number
  duration: number
  shuffleEnabled: boolean
  repeatMode: RepeatMode
  visualizationEnabled: boolean
  audioData: Uint8Array | null
  setVolume: (v: number) => void
  play: () => Promise<void>
  pause: () => void
  toggle: () => Promise<void>
  nextTrack: () => void
  previousTrack: () => void
  skipForward: () => void
  skipBackward: () => void
  seekTo: (value: number) => void
  selectTrack: (value: number, autoPlay?: boolean) => void
  toggleShuffle: () => void
  cycleRepeatMode: () => void
  toggleVisualization: () => void
  refreshBilling: () => Promise<void>
  changePlan: (planCode: string) => Promise<boolean>
  createStarsInvoice: (planCode: string) => Promise<StarsInvoice | null>
  deleteTrack: (trackId: string) => Promise<boolean>
  refreshTracks: () => Promise<void>
  syncTracks: () => Promise<void>
  getAudioElement: () => HTMLAudioElement | null
}

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
const STORAGE_VOLUME = 'player_volume'
const STORAGE_SHUFFLE = 'player_shuffle'
const STORAGE_REPEAT = 'player_repeat'
const STORAGE_VISUALIZATION = 'player_visualization'

const PlayerAudioContext = createContext<AudioContextValue | null>(null)

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function toTrackCursor(items: Track[]) {
  return items.reduce((maxId, item) => {
    const parsed = Number.parseInt(item.id, 10)
    if (Number.isNaN(parsed)) return maxId
    return Math.max(maxId, parsed)
  }, 0)
}

function parseRepeatMode(value: string | null): RepeatMode {
  if (value === 'all' || value === 'one') return value
  return 'off'
}

function getTelegramInitData() {
  const webApp = (window as any).Telegram?.WebApp
  if (webApp?.initData) return webApp.initData as string
  return (import.meta.env.VITE_DEV_INIT_DATA as string | undefined) || ''
}

export function useAudio() {
  const ctx = useContext(PlayerAudioContext)
  if (!ctx) throw new Error('AudioContext missing')
  return ctx
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<globalThis.AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const tokenRef = useRef<string | null>(null)
  const selectedTrackIdRef = useRef<string | null>(null)
  const trackCursorRef = useRef(0)
  const syncInFlightRef = useRef(false)

  const [tracks, setTracks] = useState<Track[]>([])
  const [index, setIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [plans, setPlans] = useState<PlanOption[]>([])
  const [planCode, setPlanCode] = useState('free')
  const [quotaLimitBytes, setQuotaLimitBytes] = useState(0)
  const [quotaUsedBytes, setQuotaUsedBytes] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [shuffleEnabled, setShuffleEnabled] = useState<boolean>(() => localStorage.getItem(STORAGE_SHUFFLE) === '1')
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(() => parseRepeatMode(localStorage.getItem(STORAGE_REPEAT)))
  const [volume, setVolume] = useState<number>(() => {
    const value = localStorage.getItem(STORAGE_VOLUME)
    return value ? Number(value) : 0.7
  })
  const [visualizationEnabled, setVisualizationEnabled] = useState<boolean>(
    () => localStorage.getItem(STORAGE_VISUALIZATION) === '1'
  )
  const [audioData, setAudioData] = useState<Uint8Array | null>(null)

  const current = tracks[index]

  useEffect(() => {
    selectedTrackIdRef.current = current?.id ?? null
  }, [current?.id])

  const applyBillingSnapshot = useCallback((data: any) => {
    const nextPlanCode = String(data?.plan_code || data?.current_plan_code || 'free')
    const nextQuotaLimit = Number(data?.quota_limit_bytes || 0)
    const nextQuotaUsed = Number(data?.quota_used_bytes || 0)
    setPlanCode(nextPlanCode)
    setQuotaLimitBytes(nextQuotaLimit)
    setQuotaUsedBytes(nextQuotaUsed)
  }, [])

  const authenticate = useCallback(async () => {
    setIsLoading(true)
    setAuthError(null)
    setBillingError(null)
    try {
      const res = await axios.post(`${API_URL}/auth`, {
        init_data: getTelegramInitData(),
      })
      const token = res.data?.access_token
      if (!token || typeof token !== 'string') {
        throw new Error('Auth token missing')
      }
      tokenRef.current = token
      applyBillingSnapshot(res.data)
    } catch {
      tokenRef.current = null
      trackCursorRef.current = 0
      setTracks([])
      setPlans([])
      setAuthError('Authentication failed')
      setPlanCode('free')
      setQuotaLimitBytes(0)
      setQuotaUsedBytes(0)
    } finally {
      setIsLoading(false)
    }
  }, [applyBillingSnapshot])

  const loadTracks = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    setIsLoading(true)
    try {
      const activeTrackId = selectedTrackIdRef.current
      const res = await axios.get(`${API_URL}/tracks`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const nextItems: Track[] = Array.isArray(res.data?.items) ? (res.data.items as Track[]) : []
      const payloadCursor = Number(res.data?.cursor || 0)
      setTracks(nextItems)
      trackCursorRef.current = Math.max(payloadCursor, toTrackCursor(nextItems))
      setIndex((prev) => {
        if (!nextItems.length) return 0
        if (activeTrackId) {
          const matched = nextItems.findIndex((item) => item.id === activeTrackId)
          if (matched >= 0) return matched
        }
        return Math.min(prev, nextItems.length - 1)
      })
      setCurrentTime(0)
      const activeDuration =
        nextItems.find((item) => item.id === activeTrackId)?.duration ?? nextItems[0]?.duration ?? 0
      setDuration(activeDuration)
      setAuthError(null)
    } catch {
      setTracks([])
      setAuthError('Failed to load tracks')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const loadBillingPlans = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    try {
      const res = await axios.get(`${API_URL}/billing/plans`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const nextPlans: PlanOption[] = Array.isArray(res.data?.items)
        ? (res.data.items as any[]).map((plan) => ({
            code: String(plan?.code || ''),
            name: String(plan?.name || ''),
            quota_limit_bytes: Number(plan?.quota_limit_bytes || 0),
            is_current: Boolean(plan?.is_current),
            is_available: Boolean(plan?.is_available),
            subscription_expires_at: plan?.subscription_expires_at ? String(plan.subscription_expires_at) : null,
            stars_price: plan?.stars_price === null || plan?.stars_price === undefined ? null : Number(plan.stars_price),
          }))
        : []
      setPlans(nextPlans)
      applyBillingSnapshot(res.data)
      setBillingError(null)
    } catch {
      setBillingError('Failed to load plans')
    }
  }, [applyBillingSnapshot])

  const refreshBilling = useCallback(async () => {
    await loadBillingPlans()
  }, [loadBillingPlans])

  const changePlan = useCallback(
    async (nextPlanCode: string) => {
      const token = tokenRef.current
      if (!token) return false
      setBillingError(null)
      try {
        const res = await axios.post(
          `${API_URL}/billing/plan`,
          { plan_code: nextPlanCode },
          { headers: { Authorization: `Bearer ${token}` } }
        )
        applyBillingSnapshot(res.data)
        await loadBillingPlans()
        return true
      } catch (error: any) {
        const detail = String(error?.response?.data?.detail || '')
        if (detail) {
          setBillingError(detail)
        } else {
          setBillingError('Failed to change plan')
        }
        return false
      }
    },
    [applyBillingSnapshot, loadBillingPlans]
  )

  const createStarsInvoice = useCallback(async (nextPlanCode: string) => {
    const token = tokenRef.current
    if (!token) return null
    setBillingError(null)
    try {
      const res = await axios.post(
        `${API_URL}/billing/stars/invoice`,
        { plan_code: nextPlanCode },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      return {
        plan_code: String(res.data?.plan_code || nextPlanCode),
        invoice_link: String(res.data?.invoice_link || ''),
        stars_amount: Number(res.data?.stars_amount || 0),
        period_days: Number(res.data?.period_days || 0),
      }
    } catch (error: any) {
      const detail = String(error?.response?.data?.detail || '')
      if (detail) {
        setBillingError(detail)
      } else {
        setBillingError('Failed to create payment invoice')
      }
      return null
    }
  }, [])

  const deleteTrack = useCallback(
    async (trackId: string) => {
      const token = tokenRef.current
      if (!token) return false
      try {
        const res = await axios.delete(`${API_URL}/tracks/${encodeURIComponent(trackId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        const nextQuotaUsed = Number(res.data?.quota_used_bytes)
        if (Number.isFinite(nextQuotaUsed)) {
          setQuotaUsedBytes(nextQuotaUsed)
        }

        const removedIndex = tracks.findIndex((item) => item.id === trackId)
        if (removedIndex >= 0) {
          setTracks((prev) => prev.filter((item) => item.id !== trackId))
          setIndex((prev) => {
            const nextLength = Math.max(tracks.length - 1, 0)
            if (!nextLength) return 0
            if (prev > removedIndex) return prev - 1
            if (prev === removedIndex) return Math.min(removedIndex, nextLength - 1)
            return prev
          })
        } else {
          await loadTracks()
        }

        setAuthError(null)
        return true
      } catch {
        setAuthError('Failed to delete track')
        return false
      }
    },
    [loadTracks, tracks]
  )

  const refreshTracks = useCallback(async () => {
    await loadTracks()
  }, [loadTracks])

  const syncTracks = useCallback(async () => {
    const token = tokenRef.current
    if (!token || syncInFlightRef.current) return
    if (trackCursorRef.current <= 0) {
      await loadTracks()
      return
    }

    syncInFlightRef.current = true
    try {
      const res = await axios.get(`${API_URL}/tracks`, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          since: trackCursorRef.current,
        },
      })

      const incoming: Track[] = Array.isArray(res.data?.items) ? (res.data.items as Track[]) : []
      const payloadCursor = Number(res.data?.cursor || 0)
      const incomingCursor = toTrackCursor(incoming)
      trackCursorRef.current = Math.max(trackCursorRef.current, payloadCursor, incomingCursor)

      if (!incoming.length) return

      setTracks((prev) => {
        const seen = new Set(prev.map((item) => item.id))
        const appended = incoming.filter((item) => !seen.has(item.id))
        if (!appended.length) return prev
        return [...prev, ...appended]
      })

      setAuthError(null)
    } catch {
      setAuthError('Failed to sync tracks')
    } finally {
      syncInFlightRef.current = false
    }
  }, [loadTracks])

  useEffect(() => {
    void (async () => {
      await authenticate()
      await loadBillingPlans()
      await loadTracks()
    })()
  }, [authenticate, loadBillingPlans, loadTracks])

  useEffect(() => {
    if (!tracks.length) {
      setIsPlaying(false)
      setCurrentTime(0)
      setDuration(0)
      return
    }
    if (index >= tracks.length) {
      setIndex(0)
    }
  }, [index, tracks.length])

  useEffect(() => {
    localStorage.setItem(STORAGE_SHUFFLE, shuffleEnabled ? '1' : '0')
  }, [shuffleEnabled])

  useEffect(() => {
    localStorage.setItem(STORAGE_REPEAT, repeatMode)
  }, [repeatMode])

  useEffect(() => {
    localStorage.setItem(STORAGE_VISUALIZATION, visualizationEnabled ? '1' : '0')
  }, [visualizationEnabled])

  useEffect(() => {
    if (!audioRef.current) return
    audioRef.current.volume = volume
    localStorage.setItem(STORAGE_VOLUME, String(volume))
  }, [volume])

  useEffect(() => {
    const mediaElement = audioRef.current
    if (!mediaElement) return

    const initAudioContext = async () => {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContextClass()
          if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume()
          }
          analyserRef.current = audioContextRef.current.createAnalyser()
          analyserRef.current.fftSize = 256
          analyserRef.current.smoothingTimeConstant = 0.8
          const source = audioContextRef.current.createMediaElementSource(mediaElement)
          source.connect(analyserRef.current)
          analyserRef.current.connect(audioContextRef.current.destination)
        }
      } catch {
        analyserRef.current = null
      }
    }

    void initAudioContext()
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!visualizationEnabled || !analyserRef.current || !isPlaying) {
      setAudioData(null)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      return
    }

    const bufferLength = analyserRef.current.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const updateVisualization = () => {
      if (!analyserRef.current || !isPlaying) {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current)
          animationFrameRef.current = null
        }
        return
      }
      analyserRef.current.getByteFrequencyData(dataArray)
      setAudioData(new Uint8Array(dataArray))
      animationFrameRef.current = requestAnimationFrame(updateVisualization)
    }

    updateVisualization()
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [visualizationEnabled, isPlaying])

  useEffect(() => {
    const token = tokenRef.current
    if (!audioRef.current || !current || !token) return
    const nextSrc = `${API_URL}${current.stream_url}?token=${encodeURIComponent(token)}`
    audioRef.current.src = nextSrc
    audioRef.current.load()
    setCurrentTime(0)
    setDuration(current.duration || 0)
    if (isPlaying) {
      audioRef.current.play().catch(() => {
        setIsPlaying(false)
      })
    }
  }, [current?.id])

  useEffect(() => {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.play().catch(() => {
        setIsPlaying(false)
      })
      return
    }
    audioRef.current.pause()
  }, [isPlaying])

  const pickRandomIndex = useCallback(
    (exclude: number) => {
      if (tracks.length <= 1) return exclude
      let next = exclude
      while (next === exclude) {
        next = Math.floor(Math.random() * tracks.length)
      }
      return next
    },
    [tracks.length]
  )

  const play = useCallback(async () => {
    if (!audioRef.current) return
    try {
      await audioRef.current.play()
      setIsPlaying(true)
    } catch {
      setIsPlaying(false)
    }
  }, [])

  const pause = useCallback(() => {
    if (!audioRef.current) return
    audioRef.current.pause()
    setIsPlaying(false)
  }, [])

  const toggle = useCallback(async () => {
    if (isPlaying) {
      pause()
      return
    }
    await play()
  }, [isPlaying, pause, play])

  const seekTo = useCallback(
    (value: number) => {
      if (!audioRef.current) return
      const actualDuration =
        Number.isFinite(audioRef.current.duration) && audioRef.current.duration > 0
          ? audioRef.current.duration
          : duration || current?.duration || 0
      const nextTime = clamp(value, 0, actualDuration)
      audioRef.current.currentTime = nextTime
      setCurrentTime(nextTime)
    },
    [current?.duration, duration]
  )

  const skipForward = useCallback(() => {
    if (!audioRef.current) return
    seekTo(audioRef.current.currentTime + 10)
  }, [seekTo])

  const skipBackward = useCallback(() => {
    if (!audioRef.current) return
    seekTo(audioRef.current.currentTime - 10)
  }, [seekTo])

  const nextTrack = useCallback(() => {
    if (!tracks.length) return
    if (shuffleEnabled) {
      setIndex(pickRandomIndex(index))
      return
    }
    if (index < tracks.length - 1) {
      setIndex(index + 1)
      return
    }
    if (repeatMode === 'all') {
      setIndex(0)
      return
    }
    pause()
    seekTo(0)
  }, [index, pause, pickRandomIndex, repeatMode, seekTo, shuffleEnabled, tracks.length])

  const previousTrack = useCallback(() => {
    if (audioRef.current && audioRef.current.currentTime > 3) {
      seekTo(0)
      return
    }
    if (!tracks.length) return
    if (shuffleEnabled) {
      setIndex(pickRandomIndex(index))
      return
    }
    if (index > 0) {
      setIndex(index - 1)
      return
    }
    if (repeatMode === 'all') {
      setIndex(tracks.length - 1)
    }
  }, [index, pickRandomIndex, repeatMode, seekTo, shuffleEnabled, tracks.length])

  const selectTrack = useCallback(
    (value: number, autoPlay = true) => {
      if (!tracks.length) return
      const nextIndex = clamp(Math.floor(value), 0, tracks.length - 1)
      setIndex(nextIndex)
      setCurrentTime(0)
      if (autoPlay) setIsPlaying(true)
    },
    [tracks.length]
  )

  const toggleShuffle = useCallback(() => {
    setShuffleEnabled((prev) => !prev)
  }, [])

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((prev) => {
      if (prev === 'off') return 'all'
      if (prev === 'all') return 'one'
      return 'off'
    })
  }, [])

  const toggleVisualization = useCallback(() => {
    setVisualizationEnabled((prev) => !prev)
  }, [])

  const getAudioElement = useCallback(() => audioRef.current, [])

  const onEnded = useCallback(() => {
    if (!tracks.length) return
    if (repeatMode === 'one') {
      seekTo(0)
      void play()
      return
    }

    let nextIndex: NullableIndex = null
    if (shuffleEnabled) {
      nextIndex = pickRandomIndex(index)
    } else if (index < tracks.length - 1) {
      nextIndex = index + 1
    } else if (repeatMode === 'all') {
      nextIndex = 0
    }

    if (nextIndex === null) {
      setIsPlaying(false)
      return
    }
    setIndex(nextIndex)
  }, [index, pickRandomIndex, play, repeatMode, seekTo, shuffleEnabled, tracks.length])

  const onLoadedMetadata = useCallback(() => {
    if (!audioRef.current) return
    const metadataDuration = audioRef.current.duration
    if (Number.isFinite(metadataDuration) && metadataDuration > 0) {
      setDuration(metadataDuration)
      return
    }
    setDuration(current?.duration || 0)
  }, [current?.duration])

  const onTimeUpdate = useCallback(() => {
    if (!audioRef.current) return
    setCurrentTime(audioRef.current.currentTime || 0)
  }, [])

  const value = useMemo(
    () => ({
      tracks,
      current,
      currentIndex: index,
      isPlaying,
      isLoading,
      authError,
      billingError,
      plans,
      planCode,
      quotaLimitBytes,
      quotaUsedBytes,
      volume,
      currentTime,
      duration,
      shuffleEnabled,
      repeatMode,
      visualizationEnabled,
      audioData,
      setVolume,
      play,
      pause,
      toggle,
      nextTrack,
      previousTrack,
      skipForward,
      skipBackward,
      seekTo,
      selectTrack,
      toggleShuffle,
      cycleRepeatMode,
      toggleVisualization,
      refreshBilling,
      changePlan,
      createStarsInvoice,
      deleteTrack,
      refreshTracks,
      syncTracks,
      getAudioElement,
    }),
    [
      audioData,
      authError,
      billingError,
      changePlan,
      createStarsInvoice,
      current,
      currentTime,
      cycleRepeatMode,
      deleteTrack,
      duration,
      getAudioElement,
      index,
      isLoading,
      isPlaying,
      nextTrack,
      pause,
      play,
      previousTrack,
      repeatMode,
      seekTo,
      selectTrack,
      shuffleEnabled,
      skipBackward,
      skipForward,
      toggle,
      toggleShuffle,
      toggleVisualization,
      refreshBilling,
      refreshTracks,
      syncTracks,
      tracks,
      visualizationEnabled,
      volume,
      planCode,
      plans,
      quotaLimitBytes,
      quotaUsedBytes,
    ]
  )

  return (
    <PlayerAudioContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        onEnded={onEnded}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        preload="metadata"
      />
    </PlayerAudioContext.Provider>
  )
}
