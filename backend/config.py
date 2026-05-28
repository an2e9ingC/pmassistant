import os


class Settings:
    PROJECT_NAME: str = "PMA"
    DATABASE_URL: str = "sqlite:///./data/pma.db"
    ZENTAO_BASE_URL: str = "http://192.168.0.124:8800/api.php/v1"
    ZENTAO_AUTH_ACCOUNT: str = ""
    ZENTAO_AUTH_PASSWORD: str = ""
    GITLAB_BASE_URL: str = "http://192.168.0.128/api/v4"
    GITLAB_TOKEN: str = ""
    JWT_SECRET_KEY: str = "dev-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480
    SYNC_INTERVAL_MINUTES: int = 30
    LOG_LEVEL: str = "INFO"

    def __init__(self):
        for key, default in self._defaults().items():
            val = os.environ.get(key, default)
            if isinstance(default, int):
                val = int(val)
            setattr(self, key, val)

    @classmethod
    def _defaults(cls):
        return {
            k: v for k, v in cls.__dict__.items()
            if not k.startswith("_") and k.isupper()
        }


settings = Settings()
