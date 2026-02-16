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

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const STORAGE_VOLUME = 'player_volume'
const STORAGE_SHUFFLE = 'player_shuffle'
const STORAGE_REPEAT = 'player_repeat'

export type RepeatMode = 'off' | 'all' | 'one'
type NullableIndex = number | null

type AudioContextValue = {
  tracks: Track[]
  current?: Track
  currentIndex: number
  isPlaying: boolean
  volume: number
  currentTime: number
  duration: number
  shuffleEnabled: boolean
  repeatMode: RepeatMode
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
}

const AudioContext = createContext<AudioContextValue | null>(null)

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function parseRepeatMode(value: string | null): RepeatMode {
  if (value === 'all' || value === 'one') return value
  return 'off'
}

export function useAudio() {
  const ctx = useContext(AudioContext)
  if (!ctx) throw new Error('AudioContext missing')
  return ctx
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [index, setIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [shuffleEnabled, setShuffleEnabled] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_SHUFFLE) === '1'
  })
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(() => {
    return parseRepeatMode(localStorage.getItem(STORAGE_REPEAT))
  })
  const [volume, setVolume] = useState<number>(() => {
    const v = localStorage.getItem(STORAGE_VOLUME)
    return v ? Number(v) : 0.7
  })

  const current = tracks[index]

  useEffect(() => {
    axios
      .get(`${API_URL}/tracks`)
      .then((res) => {
        setTracks(res.data.items || [])
      })
      .catch(() => {
        setTracks([])
      })
  }, [])

  useEffect(() => {
    if (!tracks.length) return
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
    if (!audioRef.current) return
    audioRef.current.volume = volume
    localStorage.setItem(STORAGE_VOLUME, String(volume))
  }, [volume])

  useEffect(() => {
    if (!audioRef.current || !current) return
    audioRef.current.src = `${API_URL}${current.stream_url}`
    audioRef.current.load()
    setCurrentTime(0)
    setDuration(current.duration)
    if (isPlaying) {
      audioRef.current.play().catch(() => {
        setIsPlaying(false)
      })
    }
  }, [current, isPlaying])

  const pickRandomIndex = useCallback(
    (exclude: number): number => {
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
      const knownDuration = Number.isFinite(audioRef.current.duration) && audioRef.current.duration > 0
        ? audioRef.current.duration
        : duration || current?.duration || 0
      const nextTime = clamp(value, 0, knownDuration)
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
      setIndex((prev) => pickRandomIndex(prev))
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
      setIndex((prev) => pickRandomIndex(prev))
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
      if (autoPlay) {
        setIsPlaying(true)
      }
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
      volume,
      currentTime,
      duration,
      shuffleEnabled,
      repeatMode,
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
    }),
    [
      current,
      currentTime,
      cycleRepeatMode,
      duration,
      index,
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
      tracks,
      volume,
    ]
  )

  return (
    <AudioContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        onEnded={onEnded}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        preload="metadata"
      />
    </AudioContext.Provider>
  )
}
