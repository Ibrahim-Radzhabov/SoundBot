interface TelegramWebApp {
  ready: () => void
  expand: () => void
}

interface Window {
  Telegram?: {
    WebApp?: TelegramWebApp
  }
}
