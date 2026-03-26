from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    telegram_bot_token: str = "dev-bot-token"
    telegram_webhook_secret: str = ""
    jwt_secret: str = "dev-jwt-secret"
    jwt_algorithm: str = "HS256"
    jwt_exp_minutes: int = 60 * 24 * 7
    cors_origins: str = "*"
    database_url: str = "sqlite:///./app.db"
    media_cache_dir: str = "media_cache"
    dev_auth_enabled: bool = True
    dev_telegram_id: int = 100001
    billing_admin_token: str = "dev-billing-admin-token"
    billing_payload_secret: str = "dev-billing-payload-secret"
    billing_invoice_ttl_sec: int = 60 * 60 * 24
    billing_stars_currency: str = "XTR"
    billing_stars_plus_amount: int = 150
    billing_stars_plus_days: int = 30
    billing_stars_pro_amount: int = 300
    billing_stars_pro_days: int = 30
    billing_sweep_enabled: bool = True
    billing_sweep_interval_sec: int = 60 * 60

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
