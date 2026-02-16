import { useEffect } from 'react'
import { AudioProvider } from './audio'
import Player from './components/Player'

const getWebApp = () => (window as any).Telegram?.WebApp

function Shell() {
  useEffect(() => {
    const webApp = getWebApp()
    if (webApp) {
      webApp.ready()
      webApp.expand()
    }
  }, [])

  return (
    <div className="min-h-screen text-white">
      <div className="mx-auto max-w-md px-6 pb-10 pt-8">
        <Player />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AudioProvider>
      <Shell />
    </AudioProvider>
  )
}
