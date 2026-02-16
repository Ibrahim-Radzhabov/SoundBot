export default function Waveform() {
  const bars = [
    0.18, 0.22, 0.3, 0.4, 0.5, 0.62, 0.72, 0.78, 0.82, 0.74, 0.68, 0.6, 0.52, 0.48,
    0.44, 0.4, 0.38, 0.42, 0.5, 0.57, 0.65, 0.76, 0.82, 0.88, 0.93, 0.86, 0.8, 0.74,
    0.68, 0.62, 0.54, 0.5, 0.44, 0.39, 0.33, 0.28,
  ]

  return (
    <div className="waveform-glass flex h-36 items-end justify-between gap-1 rounded-3xl px-4 py-4 sm:h-40">
      {bars.map((h, i) => (
        <div
          key={i}
          className="waveform-bar animate-waveFloat"
          style={{ height: `${h * 100}%`, animationDelay: `${i * 0.08}s` }}
        />
      ))}
    </div>
  )
}
