import { useEffect, useRef } from 'react'
import { useAudio } from '../audio'

export default function AudioVisualizer() {
  const { audioData, visualizationEnabled, isPlaying } = useAudio()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!visualizationEnabled || !audioData || !canvasRef.current || !isPlaying) {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
        }
      }
      return
    }

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    const barCount = Math.min(audioData.length, 128) // Используем только часть данных для лучшей производительности
    const barWidth = width / barCount
    const centerY = height / 2

    ctx.clearRect(0, 0, width, height)

    // Градиент для визуализации
    const gradient = ctx.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, 'rgba(111, 184, 255, 0.85)')
    gradient.addColorStop(0.5, 'rgba(193, 134, 255, 0.85)')
    gradient.addColorStop(1, 'rgba(255, 99, 206, 0.85)')

    ctx.fillStyle = gradient

    // Рисуем частотные бары (симметрично от центра)
    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.floor((i / barCount) * audioData.length)
      const barHeight = (audioData[dataIndex] / 255) * height * 0.4
      const x = i * barWidth
      const topY = centerY - barHeight

      // Верхняя часть бара
      ctx.fillRect(x, topY, barWidth - 2, barHeight)
      // Нижняя часть бара (зеркально)
      ctx.fillRect(x, centerY, barWidth - 2, barHeight)
    }

    // Добавляем свечение
    ctx.shadowBlur = 20
    ctx.shadowColor = 'rgba(111, 184, 255, 0.6)'
    ctx.fillStyle = gradient
    
    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.floor((i / barCount) * audioData.length)
      const barHeight = (audioData[dataIndex] / 255) * height * 0.4
      const x = i * barWidth
      const topY = centerY - barHeight

      ctx.fillRect(x, topY, barWidth - 2, barHeight)
      ctx.fillRect(x, centerY, barWidth - 2, barHeight)
    }
    
    ctx.shadowBlur = 0
  }, [audioData, visualizationEnabled, isPlaying])

  if (!visualizationEnabled) return null

  return (
    <canvas
      ref={canvasRef}
      width={370}
      height={280}
      className="absolute inset-0 w-full h-full object-cover pointer-events-none"
      style={{ mixBlendMode: 'screen', opacity: 0.9 }}
    />
  )
}
