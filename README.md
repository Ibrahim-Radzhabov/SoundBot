# Telegram Mini App Music Bot

## Backend

### Local

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export TELEGRAM_BOT_TOKEN=your_bot_token
export JWT_SECRET=your_jwt_secret
uvicorn app.main:app --reload --port 8000
```

### Docker

```bash
docker compose up --build
```

Backend доступен на `http://localhost:8000`.

## Frontend

### Local

```bash
cd frontend
npm install
VITE_API_URL=http://localhost:8000 npm run dev
```

Mini App доступен на `http://localhost:5173`.

## Media

Положите mp3 файлы в `backend/media/` с именами `1.mp3`, `2.mp3`, `3.mp3`.

## Endpoints

- `POST /auth` — проверка `initData`, выдача JWT
- `GET /tracks` — список треков
- `GET /stream/{id}` — поток аудио

## Deployment

### Backend (Render/Cloud)

1. Соберите образ из `backend/Dockerfile`.
2. Установите переменные окружения:
   - `TELEGRAM_BOT_TOKEN`
   - `JWT_SECRET`
   - `CORS_ORIGINS` (например, `https://your-domain.com`)
3. Откройте порт 8000.
4. Включите SSL на уровне платформы.

### Frontend (Vercel/Netlify)

1. Build Command: `npm run build`
2. Output: `dist`
3. Переменная окружения: `VITE_API_URL=https://api.your-domain.com`
4. Включите HTTPS.

### Telegram WebApp Setup

1. В BotFather установите `Web App` URL на HTTPS домен фронтенда.
2. Убедитесь, что фронтенд доступен по HTTPS.
3. Проверьте, что домен API добавлен в `CORS_ORIGINS`.

### Domain & SSL

- Настройте A/AAAA записи на ваш хостинг.
- Выпустите SSL сертификат (Let’s Encrypt или провайдер).
- Проверьте, что доступ по HTTPS для фронтенда и API.
