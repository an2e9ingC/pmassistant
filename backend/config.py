import os


def _load_dotenv(path: str = ".env") -> None:
    """Load KEY=VALUE pairs from a .env file into os.environ (if not already set)."""
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val


_load_dotenv()


class Settings:
    PROJECT_NAME: str = "PMA"
    DATABASE_URL: str = "sqlite:///./data/pma-8800.db"
    ZENTAO_BASE_URL: str = "http://192.168.3.22/zentao/api.php/v1"
    ZENTAO_AUTH_ACCOUNT: str = ""
    ZENTAO_AUTH_PASSWORD: str = ""
    GITLAB_BASE_URL: str = "http://192.168.0.128/api/v4"
    GITLAB_TOKEN: str = ""
    JWT_SECRET_KEY: str = "dev-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480
    SYNC_INTERVAL_MINUTES: int = 30
    LOG_LEVEL: str = "INFO"
    SQLCIPHER_KEY: str = ""  # hex key for SQLCipher encryption (empty = disabled)
    SQLCIPHER_KEY_FILE: str = ""  # path to Docker secrets file (/run/secrets/sqlcipher_key)

    def __init__(self):
        self.reload()

    def reload(self):
        """Re-read settings from os.environ (called after config changes)."""
        for key, default in self._defaults().items():
            val = os.environ.get(key, default)
            if isinstance(default, int):
                val = int(val)
            setattr(self, key, val)
        # Docker secrets: if SQLCIPHER_KEY_FILE is set, read key from the file
        if self.SQLCIPHER_KEY_FILE and os.path.exists(self.SQLCIPHER_KEY_FILE):
            with open(self.SQLCIPHER_KEY_FILE) as f:
                self.SQLCIPHER_KEY = f.read().strip()

    @classmethod
    def _defaults(cls):
        return {
            k: v for k, v in cls.__dict__.items()
            if not k.startswith("_") and k.isupper()
        }


def get_zentao_web_base() -> str:
    """Derive Zentao web UI base URL from the API base URL.
    e.g. http://192.168.3.22/zentao/api.php/v1 -> http://192.168.3.22/zentao"""
    api = settings.ZENTAO_BASE_URL.rstrip("/")
    return api.rsplit("/api.php", 1)[0]


def zentao_project_url(project_id: int) -> str:
    return f"{get_zentao_web_base()}/index.php?m=project&f=index&projectID={project_id}"


def zentao_product_url(product_id: int) -> str:
    return f"{get_zentao_web_base()}/index.php?m=product&f=dashboard&productID={product_id}"

def zentao_product_bugs_url(product_id: int) -> str:
    return f"{get_zentao_web_base()}/index.php?m=bug&f=browse&productID={product_id}"

def zentao_product_releases_url(product_id: int) -> str:
    return f"{get_zentao_web_base()}/index.php?m=release&f=browse&productID={product_id}"


settings = Settings()

# ── Server start time (epoch) — used for restart detection ──
import time as _time
SERVER_START_TIME = int(_time.time())
